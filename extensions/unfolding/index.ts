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
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { stripFrontmatter, buildUnfoldMessage } from "./unfold-helpers.ts";
import { taskList, taskRead, taskAccept, taskReopen, taskUnblock, taskRollback } from "./task-tools.ts";
import type { SessionLike } from "./task-tools.ts";
import { resumeDelegatedTask } from "./task-resume.ts";
import { filterDisplayOnlyMessages } from "./display-only.ts";
import { makeTaskDelegateDefinition } from "./task-delegate-tool.ts";

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

const UNFOLDING_CHILD_OUTPUT_TYPE = "unfolding-child-output";

function makePostOutput(pi: ExtensionAPI) {
  return (lines: string) =>
    pi.sendMessage({ customType: UNFOLDING_CHILD_OUTPUT_TYPE, content: "", display: true, details: { lines } });
}

export default function (pi: ExtensionAPI, options?: { activeSessions?: Map<string, AgentSession> }) {
  pi.on("context", async (event) =>
    filterDisplayOnlyMessages(event, UNFOLDING_CHILD_OUTPUT_TYPE) as { messages?: any[] } | undefined,
  );

  pi.registerMessageRenderer<{ lines?: string }>(UNFOLDING_CHILD_OUTPUT_TYPE, (message, _options, theme) => {
    const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
    const lines = message.details?.lines ?? message.content ?? "";
    box.addChild(new Text(lines, 0, 0));
    return box;
  });

  /** Set when /unfold is invoked; cleared after the next before_agent_start fires. */
  let pendingSkillInjection: string | null = null;

  /** Live child sessions keyed by task slug, for re-attaching after unblock/reopen. */
  const activeSessions = options?.activeSessions ?? new Map<string, AgentSession>();
  const postOutput = makePostOutput(pi);

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
      const freshProjectGuidance = !state
        ? [
            guidance,
            "This is a genuinely empty project: no existing code, no pom.xml, no tech stack to discover yet.",
            "Do not explore the workspace for implementation artifacts.",
            "Start directly with docs/product.md, then the first planning artifacts (ATs, rules, indexes, step catalogs, and only genuinely needed DMDs).",
          ].filter(Boolean).join("\n\n")
        : guidance;
      const message = buildUnfoldMessage({ state, guidance: freshProjectGuidance });

      // Arm the system-prompt injection for the upcoming turn.
      pendingSkillInjection = skill;

      pi.sendUserMessage(message);
    },
  });

  pi.registerCommand("tasks", {
    description: "Show all delegated tasks with status, blocked reason, and live session cost",
    handler: async (_args, ctx) => {
      const text = taskList(ctx.cwd, "*", activeSessions as Map<string, SessionLike>);
      ctx.ui.notify(text, "info");
    },
  });

  pi.registerTool({
    name: "ask_sensei",
    label: "Ask Sensei",
    description: "Ask the user a single question via pi UI and return the answer. Use this to relay DMD/ADR questions verbatim, one at a time.",
    parameters: Type.Object({
      question: Type.String({ description: "The single question to ask the user." }),
      context: Type.Optional(Type.String({ description: "Optional brief context shown above the question." })),
      options: Type.Optional(Type.Array(Type.String(), { description: "Optional multiple-choice options." })),
      freeText: Type.Optional(Type.Boolean({ description: "If true and options are provided, also offer an 'Other…' choice for free-text input." })),
      placeholder: Type.Optional(Type.String({ description: "Optional placeholder for free-text input." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return {
          content: [{ type: "text", text: "Error: UI not available" }],
          details: { answer: null, cancelled: true },
        };
      }

      const prompt = params.context ? `${params.context}\n\n${params.question}` : params.question;
      const options = params.options?.filter(option => option.length > 0) ?? [];

      const done = (answer: string | null, cancelled = false) => ({
        content: [{ type: "text", text: answer ?? "(cancelled)" }],
        details: { answer, cancelled },
      });

      if (options.length === 0) {
        const answer = await ctx.ui.input(prompt, params.placeholder ?? "");
        return done(answer ?? null, answer === undefined);
      }

      const otherOption = "Other…";
      const selectableOptions = params.freeText ? [...options, otherOption] : options;
      const selected = await ctx.ui.select(prompt, selectableOptions);
      if (selected === undefined) return done(null, true);
      if (selected !== otherOption) return done(selected);

      const answer = await ctx.ui.input(prompt, params.placeholder ?? "");
      return done(answer ?? null, answer === undefined);
    },
  });

  // -------------------------------------------------------------------------
  // Task tools
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "task_list",
    label: "Task list",
    description: "List all delegated tasks (root session only).",
    parameters: Type.Object({
      from: Type.Optional(Type.String({ description: "Filter by delegating role. Default: 'orchestrator' (your own tasks). Use '*' to see all tasks across all roles — only do this when explicitly investigating the full task tree." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const text = taskList(ctx.cwd, params.from ?? "orchestrator", activeSessions as Map<string, SessionLike>);
      console.log(`[task_list] from=${params.from ?? "orchestrator"}: ${text.slice(0, 200)}`);
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    name: "task_read",
    label: "Task read",
    description: "Read full details of a delegated task by slug (root session only).",
    parameters: Type.Object({ slug: Type.String({ description: "Task slug" }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const text = taskRead(ctx.cwd, params.slug);
      console.log(`[task_read] slug=${params.slug}`);
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool(makeTaskDelegateDefinition("orchestrator", activeSessions, pi, postOutput));

  pi.registerTool({
    name: "task_accept",
    label: "Task accept",
    description: "Accept a finished delegated task (commissioner).",
    parameters: Type.Object({ slug: Type.String({ description: "Task slug" }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      postOutput(`  ✅ task_accept: ${params.slug}`);
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
      postOutput(`  🔄 task_reopen: ${params.slug} — ${params.reason}`);
      const outcome = await resumeDelegatedTask({
        action: "reopen",
        cwd: ctx.cwd,
        slug: params.slug,
        reason: params.reason,
        activeSessions,
        signal,
        onUpdate,
        postOutput,
        mutateTask: taskReopen,
        pi,
        model: ctx.model,
        modelRegistry: ctx.modelRegistry,
      });

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
      postOutput(`  🔓 task_unblock: ${params.slug}${params.reason ? ` — ${params.reason}` : ""}`);
      const outcome = await resumeDelegatedTask({
        action: "unblock",
        cwd: ctx.cwd,
        slug: params.slug,
        reason: params.reason,
        activeSessions,
        signal,
        onUpdate,
        postOutput,
        mutateTask: taskUnblock,
        pi,
        model: ctx.model,
        modelRegistry: ctx.modelRegistry,
      });

      if (outcome === "aborted") {
        activeSessions.delete(params.slug);
      }

      return {
        content: [{ type: "text", text: `Task "${params.slug}" unblocked. Outcome: ${outcome}` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "task_rollback",
    label: "Task rollback",
    description: "Roll back a delegated task to its pre-delegation workspace state and delete the task file (commissioner).",
    parameters: Type.Object({
      slug: Type.String({ description: "Task slug" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      postOutput(`  ↩️ task_rollback: ${params.slug}`);
      const session = activeSessions.get(params.slug);
      if (session) await session.abort().catch(() => {});
      activeSessions.delete(params.slug);
      taskRollback(ctx.cwd, params.slug);
      return {
        content: [{ type: "text", text: `Task "${params.slug}" rolled back.` }],
        details: {},
      };
    },
  });
}
