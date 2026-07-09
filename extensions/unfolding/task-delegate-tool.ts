import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { startChildSession } from "./session-factory.ts";
import { refreshAskSenseiCallback } from "./ask-sensei.ts";
import { classifyDirectDelegate, readTask } from "./task-store.ts";
import { abortSessionStack } from "./abort-flow.ts";
import { FatalChildSessionError } from "./task-delegate.ts";
import type { ChildOutputDetails } from "./child-output.ts";
import { isUnfoldingFatalError } from "./fatal-error.ts";
import { exportTaskCommissionerDebugHtmlIfEnabled } from "./debug-export.ts";
import { assertDelegationAllowed, delegateRoleParameterSchema } from "./delegation-policy.ts";

function childOutcomeText(action: string, slug: string, role: string, outcome: "finished" | "blocked", blockedReason?: string): string {
  return outcome === "blocked"
    ? `Task "${slug}" ${action} to ${role}. Outcome: blocked. blocked_reason: ${blockedReason ?? "(no reason given)"}`
    : `Task "${slug}" ${action} to ${role}. Outcome: ${outcome}`;
}

async function runChildSession(
  action: string,
  params: { role: string; slug: string; body: string; parent_slug?: string },
  from: string,
  activeSessions: Map<string, AgentSession>,
  pi: ExtensionAPI,
  postOutput: (lines: string) => void,
  onChildOutcome: ((cwd: string, slug: string, outcome: "finished" | "blocked" | "aborted") => Promise<void> | void) | undefined,
  exportDebugHtml: ((cwd: string, slug: string) => Promise<void> | void) | undefined,
  currentCommissionerSlug: string | undefined,
  signal: AbortSignal | undefined,
  onUpdate: any,
  ctx: any,
): Promise<any> {
  const effectiveParentSlug = currentCommissionerSlug ?? params.parent_slug;
  await exportTaskCommissionerDebugHtmlIfEnabled(
    ctx.cwd,
    params.slug,
    (pi as any).__unfoldingDebugExportsEnabled === true,
    ctx.sessionManager?.getSessionFile(),
  );

  const { outcome, finalOutputDetails } = await startChildSession({
    cwd: ctx.cwd,
    from,
    role: params.role,
    slug: params.slug,
    body: params.body,
    parent_slug: effectiveParentSlug,
    activeSessions,
    pi,
    postOutput,
    nestedDelegateToolFactory: (shortRole: string, commissionerSlug: string) =>
      makeTaskDelegateDefinition(shortRole, activeSessions, pi, postOutput, onChildOutcome, exportDebugHtml, commissionerSlug),
    signal,
    parentSignal: ctx.signal,
    onUpdate,
    model: ctx.model,
    modelRegistry: ctx.modelRegistry,
  });

  await onChildOutcome?.(ctx.cwd, params.slug, outcome);
  await exportDebugHtml?.(ctx.cwd, params.slug);

  if (outcome === "aborted") {
    const reason = `task "${params.slug}" was aborted`;
    await abortSessionStack(
      ctx.cwd,
      reason,
      activeSessions,
      undefined,
      { skipSlugs: [params.slug, ...(currentCommissionerSlug ? [currentCommissionerSlug] : [])] },
    );
    if (!currentCommissionerSlug) ctx.abort?.();
    return {
      content: [{ type: "text", text: `Task "${params.slug}" aborted.` }],
      details: { aborted: true, ...finalOutputDetails },
      terminate: true,
    };
  }

  const blockedReason = outcome === "blocked" ? readTask(ctx.cwd, params.slug)?.blocked_reason : undefined;
  return {
    content: [{ type: "text", text: childOutcomeText(action, params.slug, params.role, outcome, blockedReason) }],
    details: {
      ...(blockedReason ? { blocked_reason: blockedReason } : {}),
      ...finalOutputDetails,
    },
  };
}

function delegateParametersSchema(from: string, currentCommissionerSlug?: string) {
  const base = {
    role: delegateRoleParameterSchema(from),
    slug: Type.String({ description: "Unique slug for this task" }),
    body: Type.String({ description: "Task description for the role" }),
  };
  return currentCommissionerSlug
    ? Type.Object(base)
    : Type.Object({
      ...base,
      parent_slug: Type.Optional(Type.String({ description: "Slug of the parent task, if this is a sub-delegation" })),
    });
}

export function makeTaskDelegateDefinition(
  from: string,
  activeSessions: Map<string, AgentSession>,
  pi: ExtensionAPI,
  postOutput: (lines: string) => void,
  onChildOutcome?: (cwd: string, slug: string, outcome: "finished" | "blocked" | "aborted") => Promise<void> | void,
  exportDebugHtml?: (cwd: string, slug: string) => Promise<void> | void,
  currentCommissionerSlug?: string,
): any {
  return {
    name: "task_delegate",
    label: "Task delegate",
    description: "Delegate work to a role sub-session and wait for it to finish or block. If this tool throws an error, treat it as a critical bug — stop all work immediately and report the full error message to the user.",
    parameters: delegateParametersSchema(from, currentCommissionerSlug),
    async execute(_id: string, params: { role: string; slug: string; body: string; parent_slug?: string }, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
      refreshAskSenseiCallback(pi, ctx);
      try {
        assertDelegationAllowed(from, params.role);
        const directDelegate = classifyDirectDelegate(ctx.cwd, from, currentCommissionerSlug);
        if (directDelegate.kind !== "none") {
          const existing = directDelegate.task;
          throw new Error(
            directDelegate.kind === "in_progress"
              ? `task_delegate failed: direct delegate "${existing.slug}" is already in progress. Call task_continue instead.`
              : directDelegate.kind === "finished"
                ? `task_delegate failed: direct delegate "${existing.slug}" is finished. Resolve it with task_accept(...), task_reopen(...), or task_rollback(...).`
                : `task_delegate failed: direct delegate "${existing.slug}" is blocked. Resolve it with task_unblock(...) or task_rollback(...).`,
          );
        }
        return await runChildSession("delegated", params, from, activeSessions, pi, postOutput, onChildOutcome, exportDebugHtml, currentCommissionerSlug, signal, onUpdate, ctx);
      } catch (err: unknown) {
        activeSessions.delete(params.slug);

        if (err instanceof FatalChildSessionError || isUnfoldingFatalError(err)) {
          const reason = err instanceof FatalChildSessionError
            ? `fatal child session failure in ${err.slug}: ${err.detail}`
            : err.message;
          await abortSessionStack(
            ctx.cwd,
            reason,
            activeSessions,
            postOutput,
            currentCommissionerSlug ? { skipSlugs: [currentCommissionerSlug] } : undefined,
          );
          if (!currentCommissionerSlug) ctx.abort?.();
          throw err;
        }

        const stack = err instanceof Error ? err.stack ?? err.message : String(err);
        throw new Error(`task_delegate failed:\n${stack}`);
      }
    },
  };
}

export function makeTaskContinueDefinition(
  from: string,
  activeSessions: Map<string, AgentSession>,
  pi: ExtensionAPI,
  postOutput: (lines: string) => void,
  onChildOutcome?: (cwd: string, slug: string, outcome: "finished" | "blocked" | "aborted") => Promise<void> | void,
  exportDebugHtml?: (cwd: string, slug: string) => Promise<void> | void,
  currentCommissionerSlug?: string,
): any {
  return {
    name: "task_continue",
    label: "Task continue",
    description: "Continue the current direct delegate task and return its current outcome. If there is no direct delegate, the tool explains what to do next.",
    parameters: Type.Object({}),
    async execute(_id: string, _params: {}, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
      refreshAskSenseiCallback(pi, ctx);
      const directDelegate = classifyDirectDelegate(ctx.cwd, from, currentCommissionerSlug);
      if (directDelegate.kind === "none") {
        throw new Error("There is no direct delegate to continue. If you need new delegated work, call task_delegate(role, slug, body).");
      }
      const existing = directDelegate.task;
      return runChildSession("continued", {
        role: existing.to,
        slug: existing.slug,
        body: existing.body,
        parent_slug: existing.parent_slug,
      }, from, activeSessions, pi, postOutput, onChildOutcome, exportDebugHtml, currentCommissionerSlug, signal, onUpdate, ctx);
    },
  };
}
