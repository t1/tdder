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
import { AgentSession, createAgentSession, DefaultResourceLoader, SessionManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { stripFrontmatter, buildUnfoldMessage } from "./unfold-helpers.ts";
import { ensureGitignore, createTask, readTask, updateTaskStatus } from "./task-store.ts";
import { taskList, taskRead, taskFinished, taskBlock, taskAccept, taskReopen, taskUnblock } from "./task-tools.ts";
import { loadAgentSystemPrompt, streamChildSession, waitForChildDecision, waitForResume, CHILD_FIXED_INSTRUCTION } from "./task-delegate.ts";

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
// Task tool factory
// ---------------------------------------------------------------------------

function makeTaskDelegateDefinition(from: string, activeSessions: Map<string, AgentSession>): any {
  return {
    name: "task_delegate",
    label: "Task delegate",
    description: "Delegate work to a role sub-session and wait for it to finish or block. If this tool throws an error, treat it as a critical bug — stop all work immediately and report the full error message to the user.",
    parameters: Type.Object({
      role: Type.String({ description: "Role to delegate to (e.g. po, architect, coder)" }),
      slug: Type.String({ description: "Unique slug for this task" }),
      body: Type.String({ description: "Task description for the role" }),
      parent_slug: Type.Optional(Type.String({ description: "Slug of the parent task, if this is a sub-delegation" })),
    }),
    async execute(_id: string, params: { role: string; slug: string; body: string; parent_slug?: string }, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
      try {
        const rolesDir = resolve(new URL(import.meta.url).pathname, "..", "roles");
        const shortRole = params.role.replace(/^unfolding-/, "");
        const systemPrompt = loadAgentSystemPrompt(rolesDir, shortRole);
        if (!systemPrompt) {
          throw new Error(`No agent definition found for role "${shortRole}" in ${rolesDir}`);
        }

        const parentPrompt = ctx.getSystemPrompt();
        const toolsMatch = parentPrompt.match(/^Available tools:\n((?:- .+\n?)+)/m);
        const toolsSection = toolsMatch ? `\n\nAvailable tools:\n${toolsMatch[1].trimEnd()}` : "";
        const fullSystemPrompt = systemPrompt + toolsSection;

        ensureGitignore(ctx.cwd);

        const existing = readTask(ctx.cwd, params.slug);

        const initialMessage = existing?.resume_message
          ? `${existing.resume_message}\n\n${CHILD_FIXED_INSTRUCTION}`
          : `${params.body}\n\n${CHILD_FIXED_INSTRUCTION}`;

        const loader = new DefaultResourceLoader({
          cwd: ctx.cwd,
          agentDir: getAgentDir(),
          noContextFiles: true,
          systemPromptOverride: () => fullSystemPrompt,
        });
        await loader.reload();

        const { session } = await createAgentSession({
          cwd: ctx.cwd,
          sessionManager: SessionManager.create(ctx.cwd),
          resourceLoader: loader,
          excludedToolNames: ["task_list", "task_read"],
          customTools: [
            {
              name: "task_finished",
              label: "Task finished",
              description: "Mark the current delegated task as finished and wait for commissioner decision.",
              parameters: Type.Object({}),
              async execute(_id: string, _params: {}, _signal: any, _onUpdate: any, _ctx: any) {
                taskFinished(ctx.cwd, params.slug);
                const result = await waitForResume(
                  async () => readTask(ctx.cwd, params.slug) ?? null,
                );
                return { content: [{ type: "text", text: result.message }], details: {} };
              },
            },
            {
              name: "task_block",
              label: "Task block",
              description: "Mark the current delegated task as blocked and wait for commissioner decision.",
              parameters: Type.Object({
                blocked_reason: Type.String({ description: "Why the task is blocked" }),
              }),
              async execute(_id: string, blockParams: { blocked_reason: string }, _signal: any, _onUpdate: any, _ctx: any) {
                taskBlock(ctx.cwd, params.slug, blockParams.blocked_reason);
                const result = await waitForResume(
                  async () => readTask(ctx.cwd, params.slug) ?? null,
                );
                return { content: [{ type: "text", text: result.message }], details: {} };
              },
            },
            makeTaskDelegateDefinition(shortRole, activeSessions),
          ],
        });

        activeSessions.set(params.slug, session);

        if (existing) {
          updateTaskStatus(ctx.cwd, params.slug, "in_progress");
        } else {
          createTask(ctx.cwd, {
            slug: params.slug,
            from,
            to: params.role,
            body: params.body,
            parent_slug: params.parent_slug,
            session_id: session.sessionId,
          });
        }
        // Forward parent abort (Esc) to the child session
        signal?.addEventListener("abort", () => { session.abort().catch(() => {}); });

        // Start the child session — it will park when it calls task_finished or task_block
        session.prompt(initialMessage).catch((err: unknown) => {
          const stack = err instanceof Error ? err.stack : String(err);
          console.error(`[unfolding] child session for task "${params.slug}" failed:`, stack);
        });

        // Stream child progress into this tool's output panel (if the TUI supports it)
        const stream = onUpdate
          ? streamChildSession(session, shortRole, params.slug, onUpdate)
          : undefined;

        // Wait for the child to reach a commissioner decision point
        const outcome = await waitForChildDecision(
          async () => readTask(ctx.cwd, params.slug),
          (_status: string, blocked_reason?: string) => {
            stream?.append(`  ⏸ blocked: ${blocked_reason ?? "(no reason given)"}`);
          },
          undefined,
          signal,
        );
        stream?.unsubscribe();

        if (outcome === "aborted") {
          activeSessions.delete(params.slug);
          return { content: [{ type: "text", text: `Task "${params.slug}" aborted.` }], details: {} };
        }

        return {
          content: [{ type: "text", text: `Task "${params.slug}" delegated to ${params.role}. Outcome: ${outcome}` }],
          details: {},
        };
      } catch (err: unknown) {
        activeSessions.delete(params.slug);
        const stack = err instanceof Error ? err.stack ?? err.message : String(err);
        throw new Error(`task_delegate failed:\n${stack}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  /** Set when /unfold is invoked; cleared after the next before_agent_start fires. */
  let pendingSkillInjection: string | null = null;

  /** Live child sessions keyed by task slug, for re-attaching after unblock/reopen. */
  const activeSessions = new Map<string, AgentSession>();

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
    description: "List all delegated tasks (root session only).",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      return { content: [{ type: "text", text: taskList(ctx.cwd) }], details: {} };
    },
  });

  pi.registerTool({
    name: "task_read",
    label: "Task read",
    description: "Read full details of a delegated task by slug (root session only).",
    parameters: Type.Object({ slug: Type.String({ description: "Task slug" }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return { content: [{ type: "text", text: taskRead(ctx.cwd, params.slug) }], details: {} };
    },
  });

  pi.registerTool(makeTaskDelegateDefinition("orchestrator", activeSessions));

  pi.registerTool({
    name: "task_accept",
    label: "Task accept",
    description: "Accept a finished delegated task (commissioner).",
    parameters: Type.Object({ slug: Type.String({ description: "Task slug" }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      taskAccept(ctx.cwd, params.slug);
      activeSessions.delete(params.slug);
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
    async execute(_id, params, signal, onUpdate, ctx) {
      taskReopen(ctx.cwd, params.slug, params.reason);

      const session = activeSessions.get(params.slug);
      if (!session) {
        return { content: [{ type: "text", text: `Task "${params.slug}" reopened: ${params.reason}` }], details: {} };
      }

      const task = readTask(ctx.cwd, params.slug);
      const shortRole = task?.to.replace(/^unfolding-/, "") ?? params.slug;

      const stream = onUpdate
        ? streamChildSession(session, shortRole, params.slug, onUpdate)
        : undefined;

      const outcome = await waitForChildDecision(
        async () => readTask(ctx.cwd, params.slug),
        (_status: string, blocked_reason?: string) => {
          stream?.append(`  ⏸ blocked: ${blocked_reason ?? "(no reason given)"}`);
        },
        undefined,
        signal,
      );
      stream?.unsubscribe();

      if (outcome === "aborted") {
        activeSessions.delete(params.slug);
      }

      return {
        content: [{ type: "text", text: `Task "${params.slug}" reopened. Outcome: ${outcome}` }],
        details: {},
      };
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
    async execute(_id, params, signal, onUpdate, ctx) {
      taskUnblock(ctx.cwd, params.slug, params.reason);

      const session = activeSessions.get(params.slug);
      if (!session) {
        return { content: [{ type: "text", text: `Task "${params.slug}" unblocked.` }], details: {} };
      }

      const task = readTask(ctx.cwd, params.slug);
      const shortRole = task?.to.replace(/^unfolding-/, "") ?? params.slug;

      const stream = onUpdate
        ? streamChildSession(session, shortRole, params.slug, onUpdate)
        : undefined;

      const outcome = await waitForChildDecision(
        async () => readTask(ctx.cwd, params.slug),
        (_status: string, blocked_reason?: string) => {
          stream?.append(`  ⏸ blocked: ${blocked_reason ?? "(no reason given)"}`);
        },
        undefined,
        signal,
      );
      stream?.unsubscribe();

      if (outcome === "aborted") {
        activeSessions.delete(params.slug);
      }

      return {
        content: [{ type: "text", text: `Task "${params.slug}" unblocked. Outcome: ${outcome}` }],
        details: {},
      };
    },
  });
}
