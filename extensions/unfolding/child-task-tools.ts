import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, AgentSession, AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { taskFinished, taskBlock, taskAccept, taskReopen, taskUnblock, taskRollback } from "./task-tools.ts";
import { waitForChildDecision, CHILD_FIXED_INSTRUCTION } from "./task-delegate.ts";
import { exportTaskDebugHtmlIfEnabled, exportTaskSessionHtml } from "./debug-export.ts";
import { readTask } from "./task-store.ts";
import type { AskSenseiFn, AskSenseiParams } from "./ask-sensei.ts";
import { UnfoldingFatalError } from "./fatal-error.ts";

export interface ChildCommissionerContext {
  activeSessions: Map<string, AgentSession>;
  postOutput: (lines: string) => void;
  pi: ExtensionAPI;
  askSensei?: AskSenseiFn;
  model?: Model<any>;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  debugExportsEnabled?: boolean;
}

export function createChildTaskTools(cwd: string, slug: string, nestedDelegateTool: any, commissionerCtx: ChildCommissionerContext): any[] {
  return [
    {
      name: "task_finished",
      label: "Task finished",
      description: "Mark the current delegated task as finished and stop the current run.",
      parameters: Type.Object({}),
      async execute(_id: string, _params: {}, _signal: any, _onUpdate: any, ctx: any) {
        taskFinished(cwd, slug);
        await exportTaskDebugHtmlIfEnabled(cwd, slug, commissionerCtx.debugExportsEnabled ?? false);
        ctx.abort();
        return { content: [{ type: "text", text: "task finished" }], details: {} };
      },
    },
    {
      name: "task_block",
      label: "Task block",
      description: "Mark the current delegated task as blocked and stop the current run.",
      parameters: Type.Object({
        blocked_reason: Type.String({ description: "Why the task is blocked" }),
      }),
      async execute(_id: string, blockParams: { blocked_reason: string }, _signal: any, _onUpdate: any, ctx: any) {
        taskBlock(cwd, slug, blockParams.blocked_reason);
        await exportTaskDebugHtmlIfEnabled(cwd, slug, commissionerCtx.debugExportsEnabled ?? false);
        ctx.abort();
        return { content: [{ type: "text", text: "task blocked" }], details: {} };
      },
    },
    nestedDelegateTool,
    {
      name: "ask_sensei",
      label: "Ask Sensei",
      description: "Ask the human a single question via pi UI and return the answer.",
      parameters: Type.Object({
        question: Type.String({ description: "The single question to ask the user." }),
        context: Type.Optional(Type.String({ description: "Optional brief context shown above the question." })),
        options: Type.Optional(Type.Array(Type.String(), { description: "Optional suggested answers. If you recommend one, put it first — the questionnaire defaults to the first option." })),
        placeholder: Type.Optional(Type.String({ description: "Optional placeholder for free-text input when no options are provided." })),
      }),
      async execute(_id: string, params: AskSenseiParams) {
        if (!commissionerCtx.askSensei) {
          throw new UnfoldingFatalError(
            "ASK_SENSEI_PROXY_UNAVAILABLE",
            "ask_sensei failed: no commissioner UI callback is available for this child session",
          );
        }
        const result = await commissionerCtx.askSensei(params);
        return {
          content: [{ type: "text", text: result.answer ?? "(cancelled)" }],
          details: result,
        };
      },
    },
    {
      name: "task_reopen",
      label: "Task reopen",
      description: "Reopen a finished delegated task and resume the child session (commissioner).",
      parameters: Type.Object({
        slug: Type.String({ description: "Task slug" }),
        reason: Type.String({ description: "Why the task is being reopened" }),
      }),
      async execute(_id: string, params: { slug: string; reason: string }, signal: any) {
        const childSession = commissionerCtx.activeSessions.get(params.slug);
        if (!childSession) throw new Error(`task_reopen: no live session found for slug "${params.slug}"`);

        // Wait for the session to finish aborting before we prompt it
        while (childSession.isStreaming) {
          await new Promise(r => setTimeout(r, 50));
        }

        taskReopen(cwd, params.slug, params.reason);
        const task = readTask(cwd, params.slug);
        const resumeMessage = task?.resume_message ?? params.reason;

        childSession.prompt(`${resumeMessage}\n\n${CHILD_FIXED_INSTRUCTION}`).catch((err: unknown) => {
          const stack = err instanceof Error ? err.stack : String(err);
          console.error(`[unfolding] child task_reopen prompt for "${params.slug}" failed:`, stack);
        });

        const outcome = await waitForChildDecision(
          async () => readTask(cwd, params.slug),
          undefined,
          undefined,
          signal,
        );

        await exportTaskDebugHtmlIfEnabled(cwd, params.slug, commissionerCtx.debugExportsEnabled ?? false);
        if (outcome === "aborted") commissionerCtx.activeSessions.delete(params.slug);

        const blockedReason = outcome === "blocked" ? readTask(cwd, params.slug)?.blocked_reason : undefined;
        const outcomeText = outcome === "blocked"
          ? `Task "${params.slug}" reopened. Outcome: blocked. blocked_reason: ${blockedReason ?? "(no reason given)"}`
          : `Task "${params.slug}" reopened. Outcome: ${outcome}`;
        return {
          content: [{ type: "text", text: outcomeText }],
          details: blockedReason ? { blocked_reason: blockedReason } : {},
        };
      },
    },
    {
      name: "task_unblock",
      label: "Task unblock",
      description: "Unblock a blocked delegated task and resume the child session (commissioner).",
      parameters: Type.Object({
        slug: Type.String({ description: "Task slug" }),
        reason: Type.Optional(Type.String({ description: "Why the task is now unblocked" })),
      }),
      async execute(_id: string, params: { slug: string; reason?: string }, signal: any) {
        const childSession = commissionerCtx.activeSessions.get(params.slug);
        if (!childSession) throw new Error(`task_unblock: no live session found for slug "${params.slug}"`);

        while (childSession.isStreaming) {
          await new Promise(r => setTimeout(r, 50));
        }

        taskUnblock(cwd, params.slug, params.reason);
        const task = readTask(cwd, params.slug);
        const resumeMessage = task?.resume_message ?? params.reason ?? "unblocked";

        childSession.prompt(`${resumeMessage}\n\n${CHILD_FIXED_INSTRUCTION}`).catch((err: unknown) => {
          const stack = err instanceof Error ? err.stack : String(err);
          console.error(`[unfolding] child task_unblock prompt for "${params.slug}" failed:`, stack);
        });

        const outcome = await waitForChildDecision(
          async () => readTask(cwd, params.slug),
          undefined,
          undefined,
          signal,
        );

        await exportTaskDebugHtmlIfEnabled(cwd, params.slug, commissionerCtx.debugExportsEnabled ?? false);
        if (outcome === "aborted") commissionerCtx.activeSessions.delete(params.slug);

        const blockedReason = outcome === "blocked" ? readTask(cwd, params.slug)?.blocked_reason : undefined;
        const outcomeText = outcome === "blocked"
          ? `Task "${params.slug}" unblocked. Outcome: blocked. blocked_reason: ${blockedReason ?? "(no reason given)"}`
          : `Task "${params.slug}" unblocked. Outcome: ${outcome}`;
        return {
          content: [{ type: "text", text: outcomeText }],
          details: blockedReason ? { blocked_reason: blockedReason } : {},
        };
      },
    },
    {
      name: "task_rollback",
      label: "Task rollback",
      description: "Roll back a delegated task to its pre-delegation workspace state and delete the task.",
      parameters: Type.Object({ slug: Type.String({ description: "Task slug" }) }),
      async execute(_id: string, params: { slug: string }) {
        const task = readTask(cwd, params.slug);
        const childSession = commissionerCtx.activeSessions.get(params.slug);
        if (childSession) await childSession.abort().catch(() => {});
        commissionerCtx.activeSessions.delete(params.slug);
        taskRollback(cwd, params.slug);
        if (commissionerCtx.debugExportsEnabled ?? false) {
          await exportTaskSessionHtml(cwd, params.slug, task?.session_file);
        }
        return {
          content: [{ type: "text", text: `Task "${params.slug}" rolled back.` }],
          details: {},
        };
      },
    },
    {
      name: "task_accept",
      label: "Task accept",
      description: "Accept a finished delegated task (commissioner).",
      parameters: Type.Object({ slug: Type.String({ description: "Task slug" }) }),
      async execute(_id: string, params: { slug: string }) {
        commissionerCtx.postOutput(`  ✅ task_accept: ${params.slug}`);
        await exportTaskDebugHtmlIfEnabled(cwd, params.slug, commissionerCtx.debugExportsEnabled ?? false);
        taskAccept(cwd, params.slug);
        commissionerCtx.activeSessions.delete(params.slug);
        return { content: [{ type: "text", text: `Task "${params.slug}" accepted.` }], details: {} };
      },
    },
  ];
}
