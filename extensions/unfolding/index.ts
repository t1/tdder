/**
 * Unfolding Specs extension for pi
 *
 * Registers the `/unfold` command, which loads the unfolding-orchestrator
 * skill into the current session and sends a turn-starting user message.
 *
 * Placement: extensions/unfolding/index.ts  (part of the t1/tdder pi package)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { stripFrontmatter, buildUnfoldMessage } from "./unfold-helpers.ts";
import { taskList, taskRead, taskAccept, taskReopen, taskUnblock, taskRollback } from "./task-tools.ts";
import { readTask } from "./task-store.ts";
import { listTasks } from "./task-store.ts";
import type { SessionLike } from "./task-tools.ts";
import { resumeDelegatedTask } from "./task-resume.ts";
import { filterDisplayOnlyMessages } from "./display-only.ts";
import { makeTaskDelegateDefinition } from "./task-delegate-tool.ts";
import { createAskSenseiFn, refreshAskSenseiCallback } from "./ask-sensei.ts";
import { abortSessionStack } from "./abort-flow.ts";
import { FatalChildSessionError, loadAgentRoleConfig } from "./task-delegate.ts";
import { isUnfoldingFatalError } from "./fatal-error.ts";
import { exportTaskCommissionerDebugHtmlIfEnabled, exportTaskDebugHtmlIfEnabled } from "./debug-export.ts";
import { childOutputCommissionerNote, renderChildOutputBox, renderChildOutputResult, type ChildOutputDetails } from "./child-output.ts";
import { buildConnectOptions, launchInTmux } from "./connect-session.ts";

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

function inferInheritedExtensionPaths(pi: ExtensionAPI): string[] {
  const toolSources = pi.getAllTools().map(tool => tool.sourceInfo);
  const commandSources = pi.getCommands()
    .filter(command => command.source === "extension")
    .map(command => command.sourceInfo);

  const seen = new Set<string>();
  return [...toolSources, ...commandSources]
    .flatMap(sourceInfo => {
      const baseDir = sourceInfo.baseDir;
      if (!baseDir) return [];
      const extensionDir = dirname(baseDir);
      return [extensionDir];
    })
    .filter(path => {
      if (seen.has(path)) return false;
      seen.add(path);
      return true;
    })
    .sort();
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

const UNFOLDING_CHILD_OUTPUT_TYPE = "unfolding-child-output";

function makePostOutput(pi: ExtensionAPI) {
  return (line: string) =>
    pi.sendMessage({
      customType: UNFOLDING_CHILD_OUTPUT_TYPE,
      content: "",
      display: true,
      details: { childOutputRole: "assistant", childOutputEvents: [childOutputCommissionerNote(line)] },
    });
}

export default function (pi: ExtensionAPI, options?: { activeSessions?: Map<string, AgentSession> }) {
  (pi as any).__unfoldingAskSensei = undefined;
  (pi as any).__unfoldingDebugExportsEnabled = false;
  (pi as any).__unfoldingExtensionPaths = undefined;

  pi.on("session_start", async () => {
    (pi as any).__unfoldingExtensionPaths = inferInheritedExtensionPaths(pi);
  });

  pi.on("context", async (event) =>
    filterDisplayOnlyMessages(event, UNFOLDING_CHILD_OUTPUT_TYPE) as { messages?: any[] } | undefined,
  );

  pi.registerMessageRenderer<ChildOutputDetails>(UNFOLDING_CHILD_OUTPUT_TYPE, (message, _options, theme) => {
    const events = message.details?.childOutputEvents;
    if (!events || events.length === 0) return undefined;
    return {
      render(width: number) {
        return renderChildOutputBox("assistant", events, theme, Math.max(1, width));
      },
      invalidate() {
      },
    };
  });

  /** Set when /unfold is invoked; cleared after the next before_agent_start fires. */
  let pendingSkillInjection: string | null = null;
  let debugExportsEnabled = false;

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

      const argText = args?.trim() || "";
      const debug = argText.includes("--debug");
      const guidance = argText.replace(/(^|\s)--debug(?=\s|$)/g, " ").trim() || undefined;
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
      debugExportsEnabled = debug;
      (pi as any).__unfoldingDebugExportsEnabled = debug;

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

  pi.registerCommand("connect-session", {
    description: "Pick an unfolding sub-session to open in a new tmux window",
    handler: async (_args, ctx) => {
      const tasks = listTasks(ctx.cwd).filter(
        t => t.session_file && existsSync(t.session_file),
      );
      if (tasks.length === 0) {
        ctx.ui.notify("No sub-sessions found.", "info");
        return;
      }
      const options = buildConnectOptions(
        tasks,
        ctx.sessionManager?.getSessionFile(),
      );
      const labels = options.map(o => o.label);
      const chosen = await ctx.ui.select("Connect to a sub-session:", labels);
      if (!chosen || chosen === options[options.length - 1]?.label) return;
      const option = options.find(o => o.label === chosen);
      if (!option) return;
      const rolesDir = resolve(new URL(import.meta.url).pathname, "..", "roles");
      const shortRole = option.role.replace(/^unfolding-/, "");
      const systemPrompt = loadAgentRoleConfig(rolesDir, shortRole)?.systemPrompt;
      let result;
      try {
        result = await launchInTmux(option, (cmd, args) => pi.exec(cmd, args), process.env.TMUX, systemPrompt);
      } catch (err) {
        ctx.ui.notify(`Failed to open tmux window: ${err instanceof Error ? err.message : String(err)}`, "error");
        return;
      }
      if (result.launched) {
        ctx.ui.notify(`Opened [${option.slug}] in a new tmux window.`, "info");
      } else {
        ctx.ui.notify(`Not inside tmux. Run manually:\n${result.fallbackCommand}`, "warning");
      }
    },
  });

  pi.registerTool({
    name: "ask_sensei",
    label: "Ask Sensei",
    description: "Ask the user a single question via pi UI and return the answer. Use this for direct role questioning, one question at a time.",
    parameters: Type.Object({
      question: Type.String({ description: "The single question to ask the user." }),
      context: Type.Optional(Type.String({ description: "Optional brief context shown above the question." })),
      options: Type.Optional(Type.Array(Type.String(), { description: "Optional suggested answers. If you recommend one, put it first — the questionnaire defaults to the first option." })),
      placeholder: Type.Optional(Type.String({ description: "Optional placeholder for free-text input when no options are provided." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const askSensei = createAskSenseiFn(ctx);
      (pi as any).__unfoldingAskSensei = askSensei;
      const answer = await askSensei(params);
      return {
        content: [{ type: "text", text: answer }],
        details: { answer },
      };
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
      refreshAskSenseiCallback(pi, ctx);
      const text = taskRead(ctx.cwd, params.slug);
      console.log(`[task_read] slug=${params.slug}`);
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    ...makeTaskDelegateDefinition(
      "orchestrator",
      activeSessions,
      pi,
      postOutput,
      undefined,
      (cwd, slug) => exportTaskDebugHtmlIfEnabled(cwd, slug, debugExportsEnabled),
      undefined,
      undefined,
    ),
    renderShell: "self",
    renderCall: (_args, _theme) => new Text("", 0, 0),
    renderResult: (result: AgentToolResult<ChildOutputDetails>, options, theme) => renderChildOutputResult(result, options, theme),
  });

  pi.registerTool({
    name: "task_accept",
    label: "Task accept",
    description: "Accept a finished delegated task (commissioner).",
    parameters: Type.Object({ slug: Type.String({ description: "Task slug" }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      refreshAskSenseiCallback(pi, ctx);
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
      refreshAskSenseiCallback(pi, ctx);
      postOutput(`  🔄 task_reopen: ${params.slug} — ${params.reason}`);
      try {
        await exportTaskCommissionerDebugHtmlIfEnabled(
          ctx.cwd,
          params.slug,
          debugExportsEnabled,
          ctx.sessionManager?.getSessionFile(),
        );
        const outcome = await resumeDelegatedTask({
          action: "reopen",
          cwd: ctx.cwd,
          slug: params.slug,
          reason: params.reason,
          activeSessions,
          signal,
          parentSignal: ctx.signal,
          onUpdate,
          postOutput,
          mutateTask: taskReopen,
          pi,
          model: ctx.model,
          modelRegistry: ctx.modelRegistry,
          exportDebugHtml: (cwd, slug) => exportTaskDebugHtmlIfEnabled(cwd, slug, debugExportsEnabled),
        });

        if (outcome === "aborted") {
          const reason = `task "${params.slug}" was aborted`;
          await abortSessionStack(ctx.cwd, reason, activeSessions);
          const finalOutputDetails = (resumeDelegatedTask as any).lastFinalOutputDetails as ChildOutputDetails | undefined;
          ctx.abort?.();
          return {
            content: [{ type: "text", text: `Task "${params.slug}" aborted.` }],
            details: { aborted: true, ...finalOutputDetails },
            terminate: true,
          };
        }

        const blockedReason = outcome === "blocked" ? readTask(ctx.cwd, params.slug)?.blocked_reason : undefined;
        const outcomeText = outcome === "blocked"
          ? `Task "${params.slug}" reopened. Outcome: blocked. blocked_reason: ${blockedReason ?? "(no reason given)"}`
          : `Task "${params.slug}" reopened. Outcome: ${outcome}`;
        return {
          content: [{ type: "text", text: outcomeText }],
          details: blockedReason ? { blocked_reason: blockedReason } : {},
        };
      } catch (err: unknown) {
        if (err instanceof FatalChildSessionError || isUnfoldingFatalError(err)) {
          const reason = err instanceof FatalChildSessionError
            ? `fatal child session failure in ${err.slug}: ${err.detail}`
            : err.message;
          await abortSessionStack(ctx.cwd, reason, activeSessions, postOutput);
          ctx.abort?.();
        }
        throw err;
      }
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
      refreshAskSenseiCallback(pi, ctx);
      postOutput(`  🔓 task_unblock: ${params.slug}${params.reason ? ` — ${params.reason}` : ""}`);
      try {
        await exportTaskCommissionerDebugHtmlIfEnabled(
          ctx.cwd,
          params.slug,
          debugExportsEnabled,
          ctx.sessionManager?.getSessionFile(),
        );
        const outcome = await resumeDelegatedTask({
          action: "unblock",
          cwd: ctx.cwd,
          slug: params.slug,
          reason: params.reason,
          activeSessions,
          signal,
          parentSignal: ctx.signal,
          onUpdate,
          postOutput,
          mutateTask: taskUnblock,
          pi,
          model: ctx.model,
          modelRegistry: ctx.modelRegistry,
          exportDebugHtml: (cwd, slug) => exportTaskDebugHtmlIfEnabled(cwd, slug, debugExportsEnabled),
        });

        if (outcome === "aborted") {
          const reason = `task "${params.slug}" was aborted`;
          await abortSessionStack(ctx.cwd, reason, activeSessions);
          const finalOutputDetails = (resumeDelegatedTask as any).lastFinalOutputDetails as ChildOutputDetails | undefined;
          ctx.abort?.();
          return {
            content: [{ type: "text", text: `Task "${params.slug}" aborted.` }],
            details: { aborted: true, ...finalOutputDetails },
            terminate: true,
          };
        }

        const blockedReason = outcome === "blocked" ? readTask(ctx.cwd, params.slug)?.blocked_reason : undefined;
        const outcomeText = outcome === "blocked"
          ? `Task "${params.slug}" unblocked. Outcome: blocked. blocked_reason: ${blockedReason ?? "(no reason given)"}`
          : `Task "${params.slug}" unblocked. Outcome: ${outcome}`;
        return {
          content: [{ type: "text", text: outcomeText }],
          details: blockedReason ? { blocked_reason: blockedReason } : {},
        };
      } catch (err: unknown) {
        if (err instanceof FatalChildSessionError || isUnfoldingFatalError(err)) {
          const reason = err instanceof FatalChildSessionError
            ? `fatal child session failure in ${err.slug}: ${err.detail}`
            : err.message;
          await abortSessionStack(ctx.cwd, reason, activeSessions, postOutput);
          ctx.abort?.();
        }
        throw err;
      }
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
      refreshAskSenseiCallback(pi, ctx);
      postOutput(`  ↩ task_rollback: ${params.slug}`);
      const childSession = activeSessions.get(params.slug);
      if (childSession) await childSession.abort().catch(() => {
      });
      activeSessions.delete(params.slug);
      taskRollback(ctx.cwd, params.slug);
      return { content: [{ type: "text", text: `Task "${params.slug}" rolled back.` }], details: {} };
    },
  });
}
