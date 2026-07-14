import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, AgentSession, AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { taskFinished, taskBlock, taskAccept, taskReopen, taskUnblock, taskRollback } from "./task-tools.ts";
import { CHILD_FIXED_INSTRUCTION } from "./task-delegate.ts";
import { exportTaskCommissionerDebugHtmlIfEnabled, exportTaskDebugHtmlIfEnabled } from "./debug-export.ts";
import { readTask, updateTaskStatus } from "./task-store.ts";
import { askSenseiViaUi, type AskSenseiParams } from "./ask-sensei.ts";
import { resumeDelegatedTask } from "./task-resume.ts";
import type { CostLedger } from "./cost-ledger.ts";

export interface ChildCommissionerContext {
  activeSessions: Map<string, AgentSession>;
  postOutput: (lines: string) => void;
  pi: ExtensionAPI;
  role?: string;
  model?: Model<any>;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  debugExportsEnabled?: boolean;
  costLedger?: CostLedger;
}

export function createChildTaskTools(cwd: string, slug: string, nestedDelegateTool: any, nestedContinueTool: any, commissionerCtx: ChildCommissionerContext): any[] {
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
        return { content: [{ type: "text", text: "task finished" }], details: {}, terminate: true };
      },
    },
    {
      name: "task_block",
      label: "Task block",
      description: "Mark the current delegated task as blocked and stop the current run. Provide exactly one of blocked_reason or recreate.resume_message.",
      parameters: Type.Object({
        blocked_reason: Type.Optional(Type.String({ description: "Why the task is blocked" })),
        recreate: Type.Optional(Type.Object({
          resume_message: Type.String({ description: "First message for the recreated session to continue with" }),
        })),
      }),
      async execute(
        _id: string,
        blockParams: { blocked_reason?: string; recreate?: { resume_message: string } },
        _signal: any,
        _onUpdate: any,
        ctx: any,
      ) {
        const hasBlockedReason = typeof blockParams.blocked_reason === "string";
        const hasRecreate = typeof blockParams.recreate?.resume_message === "string";
        if (hasBlockedReason === hasRecreate) {
          throw new Error("task_block requires exactly one of blocked_reason or recreate.resume_message");
        }
        if (hasRecreate) {
          updateTaskStatus(cwd, slug, "blocked", undefined, undefined, blockParams.recreate!.resume_message);
        } else {
          taskBlock(cwd, slug, blockParams.blocked_reason);
        }
        await exportTaskDebugHtmlIfEnabled(cwd, slug, commissionerCtx.debugExportsEnabled ?? false);
        ctx.abort();
        return { content: [{ type: "text", text: "task blocked" }], details: {}, terminate: true };
      },
    },
    nestedDelegateTool,
    nestedContinueTool,
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
      async execute(_id: string, params: AskSenseiParams, _signal: any, _onUpdate: any, ctx: any) {
        const labeledParams: AskSenseiParams = commissionerCtx.role
          ? { ...params, role: commissionerCtx.role }
          : params;
        const answer = await askSenseiViaUi(labeledParams, ctx);
        return {
          content: [{ type: "text", text: answer }],
          details: { answer },
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
      async execute(_id: string, params: { slug: string; reason: string }, signal: any, onUpdate: any, ctx: any) {
        await exportTaskCommissionerDebugHtmlIfEnabled(
          cwd,
          params.slug,
          commissionerCtx.debugExportsEnabled ?? false,
          ctx.sessionManager?.getSessionFile(),
        );
        const outcome = await resumeDelegatedTask({
          action: "reopen",
          cwd,
          slug: params.slug,
          reason: params.reason,
          activeSessions: commissionerCtx.activeSessions,
          signal,
          parentSignal: ctx.signal,
          onUpdate,
          postOutput: commissionerCtx.postOutput,
          mutateTask: (cwd, slug, reason) => taskReopen(cwd, slug, reason ?? params.reason),
          pi: commissionerCtx.pi,
          model: commissionerCtx.model,
          authStorage: commissionerCtx.authStorage,
          modelRegistry: commissionerCtx.modelRegistry,
          exportDebugHtml: commissionerCtx.debugExportsEnabled
            ? (cwd, slug) => exportTaskDebugHtmlIfEnabled(cwd, slug, true)
            : undefined,
          costLedger: commissionerCtx.costLedger,
        });
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
      async execute(_id: string, params: { slug: string; reason?: string }, signal: any, onUpdate: any, ctx: any) {
        await exportTaskCommissionerDebugHtmlIfEnabled(
          cwd,
          params.slug,
          commissionerCtx.debugExportsEnabled ?? false,
          ctx.sessionManager?.getSessionFile(),
        );
        const outcome = await resumeDelegatedTask({
          action: "unblock",
          cwd,
          slug: params.slug,
          reason: params.reason,
          activeSessions: commissionerCtx.activeSessions,
          signal,
          parentSignal: ctx.signal,
          onUpdate,
          postOutput: commissionerCtx.postOutput,
          mutateTask: (cwd, slug, reason) => taskUnblock(cwd, slug, reason),
          pi: commissionerCtx.pi,
          model: commissionerCtx.model,
          authStorage: commissionerCtx.authStorage,
          modelRegistry: commissionerCtx.modelRegistry,
          exportDebugHtml: commissionerCtx.debugExportsEnabled
            ? (cwd, slug) => exportTaskDebugHtmlIfEnabled(cwd, slug, true)
            : undefined,
          costLedger: commissionerCtx.costLedger,
        });
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
        const childSession = commissionerCtx.activeSessions.get(params.slug);
        const task = readTask(cwd, params.slug);
        if (childSession && commissionerCtx.costLedger) {
          await childSession.abort().catch(() => {});
          if (typeof childSession.getSessionStats === "function") {
            const stats = childSession.getSessionStats();
            commissionerCtx.costLedger.record(
              { slug: params.slug, role: task?.to ?? "", parent_slug: task?.parent_slug, status: "rolled back", cost: stats.cost, tokens: { input: stats.tokens.input, output: stats.tokens.output } },
              false,
            );
          } else {
            commissionerCtx.costLedger.updateStatus(params.slug, "rolled back");
          }
        } else {
          if (childSession) await childSession.abort().catch(() => {});
          commissionerCtx.costLedger?.updateStatus(params.slug, "rolled back");
        }
        commissionerCtx.activeSessions.delete(params.slug);
        taskRollback(cwd, params.slug);
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
        taskAccept(cwd, params.slug);
        commissionerCtx.activeSessions.delete(params.slug);
        return { content: [{ type: "text", text: `Task "${params.slug}" accepted.` }], details: {} };
      },
    },
  ];
}
