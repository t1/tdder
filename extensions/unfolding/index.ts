/**
 * Unfolding Specs extension for pi
 *
 * Registers the `/unfold` command, which loads the unfolding-orchestrator
 * skill into the current session and sends a turn-starting user message.
 *
 * Placement: extensions/unfolding/index.ts  (part of the t1/tdder pi package)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { stripFrontmatter, buildUnfoldMessage } from "./unfold-helpers.ts";
import { ensureGitignore, createTask, readTask, listTasks, updateTaskStatus, deleteTask } from "./task-store.ts";
import { taskList, taskRead, taskFinished, taskBlock, taskAccept, taskReopen, taskUnblock } from "./task-tools.ts";
import { loadAgentSystemPrompt, waitForChildDecision, waitForResume, CHILD_FIXED_INSTRUCTION } from "./task-delegate.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the path to the orchestrator skill relative to this extension. */
function orchestratorSkillPath(): string {
  // In the installed package, agents/ and skills/ sit at the package root,
  // two directories above this file (extensions/unfolding/index.ts).
  return resolve(new URL(import.meta.url).pathname, "../../..", "skills/unfolding-orchestrator/SKILL.md");
}

/** Load the orchestrator skill body. Returns null if the file is missing. */
function loadOrchestratorSkill(): string | null {
  const path = orchestratorSkillPath();
  if (!existsSync(path)) return null;
  return stripFrontmatter(readFileSync(path, "utf8"));
}

/** Load docs/state.yaml from the project cwd. Returns null if absent. */
function loadStateYaml(cwd: string): string | null {
  const path = join(cwd, "docs/state.yaml");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").trim();
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  /** Set when /unfold is invoked; cleared after the next before_agent_start fires. */
  let pendingSkillInjection: string | null = null;

  // Inject the orchestrator skill into the system prompt for the turn that
  // follows an /unfold invocation.
  pi.on("before_agent_start", async (event) => {
    if (pendingSkillInjection === null) return;
    const skill = pendingSkillInjection;
    pendingSkillInjection = null;
    return {
      systemPrompt: event.systemPrompt + "\n\n" + skill,
    };
  });

  pi.registerCommand("unfold", {
    description: "Resume or start Unfolding Specs for this project",
    handler: async (args, ctx) => {
      const skill = loadOrchestratorSkill();
      if (!skill) {
        ctx.ui.notify(
          "unfolding-orchestrator skill not found — is tdder installed correctly?",
          "error",
        );
        return;
      }

      if (!ctx.isIdle()) {
        ctx.ui.notify("/unfold: agent is busy, try again when idle", "warning");
        return;
      }

      const guidance = args?.trim() || undefined;
      const state = loadStateYaml(ctx.cwd);
      const message = buildUnfoldMessage({ state, guidance });

      // Arm the system-prompt injection for the upcoming turn.
      pendingSkillInjection = skill;

      pi.sendUserMessage(message);
    },
  });

  // -------------------------------------------------------------------------
  // Task tools
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "task_list",
    label: "Task list",
    description: "List all delegated tasks (orchestrator only).",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      return { content: [{ type: "text", text: taskList(ctx.cwd) }], details: {} };
    },
  });

  pi.registerTool({
    name: "task_read",
    label: "Task read",
    description: "Read full details of a delegated task by slug (orchestrator only).",
    parameters: Type.Object({ slug: Type.String({ description: "Task slug" }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return { content: [{ type: "text", text: taskRead(ctx.cwd, params.slug) }], details: {} };
    },
  });

  pi.registerTool({
    name: "task_finished",
    label: "Task finished",
    description: "Mark the current delegated task as finished and wait for commissioner decision.",
    parameters: Type.Object({ slug: Type.String({ description: "Task slug" }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      taskFinished(ctx.cwd, params.slug);
      const outcome = await waitForResume(
        async () => readTask(ctx.cwd, params.slug)?.status ?? null,
      );
      return {
        content: [{ type: "text", text: `Task "${params.slug}" finished. Commissioner decision: ${outcome}` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "task_block",
    label: "Task block",
    description: "Mark the current delegated task as blocked and wait for commissioner decision.",
    parameters: Type.Object({
      slug: Type.String({ description: "Task slug" }),
      blocked_reason: Type.String({ description: "Why the task is blocked" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      taskBlock(ctx.cwd, params.slug, params.blocked_reason);
      const outcome = await waitForResume(
        async () => readTask(ctx.cwd, params.slug)?.status ?? null,
      );
      return {
        content: [{ type: "text", text: `Task "${params.slug}" blocked. Commissioner decision: ${outcome}` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "task_delegate",
    label: "Task delegate",
    description: "Delegate work to a role sub-session and wait for it to finish or block.",
    parameters: Type.Object({
      role: Type.String({ description: "Role to delegate to (e.g. po, architect, coder)" }),
      slug: Type.String({ description: "Unique slug for this task" }),
      body: Type.String({ description: "Task description for the role" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const agentsDir = resolve(new URL(import.meta.url).pathname, "../../..", "agents");
      const systemPrompt = loadAgentSystemPrompt(agentsDir, params.role);
      if (!systemPrompt) {
        throw new Error(`No agent definition found for role "${params.role}" in ${agentsDir}`);
      }

      ensureGitignore(ctx.cwd);
      const initialMessage = `${params.body}\n\n${CHILD_FIXED_INSTRUCTION}`;

      const loader = new DefaultResourceLoader({
        cwd: ctx.cwd,
        systemPromptOverride: () => systemPrompt,
      });
      await loader.reload();

      const { session } = await createAgentSession({
        cwd: ctx.cwd,
        sessionManager: SessionManager.create(ctx.cwd),
        resourceLoader: loader,
      });

      const task = createTask(ctx.cwd, {
        slug: params.slug,
        from: "orchestrator",
        to: params.role,
        body: params.body,
        session_id: session.sessionId,
      });

      // Start the child session — it will park when it calls task_finished or task_block
      session.prompt(initialMessage).catch((err: unknown) => {
        console.error(`[unfolding] child session for task "${params.slug}" failed:`, err);
      });

      // Wait for the child to reach a commissioner decision point
      const outcome = await waitForChildDecision(
        async () => readTask(ctx.cwd, task.slug)?.status ?? null,
      );

      return {
        content: [{ type: "text", text: `Task "${params.slug}" delegated to ${params.role}. Outcome: ${outcome}` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "task_accept",
    label: "Task accept",
    description: "Accept a finished delegated task (commissioner).",
    parameters: Type.Object({ slug: Type.String({ description: "Task slug" }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      taskAccept(ctx.cwd, params.slug);
      return { content: [{ type: "text", text: `Task "${params.slug}" accepted.` }], details: {} };
    },
  });

  pi.registerTool({
    name: "task_reopen",
    label: "Task reopen",
    description: "Reopen a finished delegated task and resume the child session (commissioner).",
    parameters: Type.Object({
      slug: Type.String({ description: "Task slug" }),
      reason: Type.String({ description: "Why the task is being reopened" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      taskReopen(ctx.cwd, params.slug, params.reason);
      return { content: [{ type: "text", text: `Task "${params.slug}" reopened: ${params.reason}` }], details: {} };
    },
  });

  pi.registerTool({
    name: "task_unblock",
    label: "Task unblock",
    description: "Unblock a blocked delegated task and resume the child session (commissioner).",
    parameters: Type.Object({
      slug: Type.String({ description: "Task slug" }),
      reason: Type.Optional(Type.String({ description: "Optional context for the unblock" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      taskUnblock(ctx.cwd, params.slug, params.reason);
      return { content: [{ type: "text", text: `Task "${params.slug}" unblocked.` }], details: {} };
    },
  });
}
