import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { startChildSession } from "./session-factory.ts";
import { refreshAskSenseiCallback } from "./ask-sensei.ts";
import { readTask } from "./task-store.ts";
import { abortAllActiveSessions, renderAbortSummary } from "./abort-flow.ts";
import { FatalChildSessionError } from "./task-delegate.ts";
import { isUnfoldingFatalError } from "./fatal-error.ts";

export function makeTaskDelegateDefinition(
  from: string,
  activeSessions: Map<string, AgentSession>,
  pi: ExtensionAPI,
  postOutput: (lines: string) => void,
  onChildOutcome?: (cwd: string, slug: string, outcome: "finished" | "blocked" | "aborted") => Promise<void> | void,
  exportDebugHtml?: (cwd: string, slug: string) => Promise<void> | void,
): any {
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
      refreshAskSenseiCallback(pi, ctx);
      try {
        const { outcome } = await startChildSession({
          cwd: ctx.cwd,
          from,
          role: params.role,
          slug: params.slug,
          body: params.body,
          parent_slug: params.parent_slug,
          activeSessions,
          pi,
          postOutput,
          nestedDelegateToolFactory: (shortRole: string) =>
            makeTaskDelegateDefinition(shortRole, activeSessions, pi, postOutput, onChildOutcome, exportDebugHtml),
          signal,
          onUpdate,
          model: ctx.model,
          modelRegistry: ctx.modelRegistry,
        });

        await onChildOutcome?.(ctx.cwd, params.slug, outcome);
        await exportDebugHtml?.(ctx.cwd, params.slug);

        if (outcome === "aborted") {
          activeSessions.delete(params.slug);
          return { content: [{ type: "text", text: `Task "${params.slug}" aborted.` }], details: {} };
        }

        const blockedReason = outcome === "blocked" ? readTask(ctx.cwd, params.slug)?.blocked_reason : undefined;
        const outcomeText = outcome === "blocked"
          ? `Task "${params.slug}" delegated to ${params.role}. Outcome: blocked. blocked_reason: ${blockedReason ?? "(no reason given)"}`
          : `Task "${params.slug}" delegated to ${params.role}. Outcome: ${outcome}`;
        return {
          content: [{ type: "text", text: outcomeText }],
          details: blockedReason ? { blocked_reason: blockedReason } : {},
        };
      } catch (err: unknown) {
        activeSessions.delete(params.slug);

        if (err instanceof FatalChildSessionError || isUnfoldingFatalError(err)) {
          const reason = err instanceof FatalChildSessionError
            ? `fatal child session failure in ${err.slug}: ${err.detail}`
            : err.message;
          await abortAllActiveSessions(activeSessions);
          postOutput(renderAbortSummary(ctx.cwd, reason, activeSessions));
          ctx.abort();
          throw err;
        }

        const stack = err instanceof Error ? err.stack ?? err.message : String(err);
        throw new Error(`task_delegate failed:\n${stack}`);
      }
    },
  };
}
