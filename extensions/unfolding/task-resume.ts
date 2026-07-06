import type { Model } from "@earendil-works/pi-ai";
import type { AgentSession, AgentToolUpdateCallback, ExtensionAPI, AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { readTask, updateTaskStatus } from "./task-store.ts";
import {
  childSessionFailureBlockedReason,
  installCheckpointRecovery,
  streamChildSession,
  waitForChildDecision,
  CHILD_FIXED_INSTRUCTION,
} from "./task-delegate.ts";
import { restoreChildSession } from "./session-restore.ts";
import { makeTaskDelegateDefinition } from "./task-delegate-tool.ts";
import type { ChildOutputDetails } from "./child-output.ts";

export interface ResumeDelegatedTaskParams {
  action: "reopen" | "unblock";
  cwd: string;
  slug: string;
  reason?: string;
  activeSessions: Map<string, AgentSession>;
  signal?: AbortSignal;
  parentSignal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<ChildOutputDetails>;
  postOutput: (lines: string) => void;
  mutateTask: (cwd: string, slug: string, reason?: string) => void;
  pi: ExtensionAPI;
  model?: Model<any>;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  exportDebugHtml?: (cwd: string, slug: string) => Promise<void> | void;
}

function missingSessionMessage(action: "reopen" | "unblock", slug: string): string {
  return (
    `task_${action}: no live session found for slug "${slug}", and the session could not be restored. ` +
    `This is likely a bug in the unfolding extension — if you don't fully understand the cause, ` +
    `print out the current situation and stop working.`
  );
}

export async function resumeDelegatedTask({
  action,
  cwd,
  slug,
  reason,
  activeSessions,
  signal,
  parentSignal,
  onUpdate,
  postOutput,
  mutateTask,
  pi,
  model,
  authStorage,
  modelRegistry,
  exportDebugHtml,
}: ResumeDelegatedTaskParams): Promise<"finished" | "blocked" | "aborted"> {
  let session = activeSessions.get(slug);
  let shutdown: (() => Promise<void>) | undefined;
  if (!session) {
    const restored = await restoreChildSession(
      cwd,
      slug,
      activeSessions,
      pi,
      postOutput,
      (shortRole: string) => makeTaskDelegateDefinition(shortRole, activeSessions, pi, postOutput, undefined, exportDebugHtml),
      model,
      authStorage,
      modelRegistry,
    );
    session = restored?.session;
    shutdown = restored?.shutdown;
  }
  if (!session) {
    const message = missingSessionMessage(action, slug);
    postOutput(`  ⚠ ${message}`);
    throw new Error(message);
  }

  mutateTask(cwd, slug, reason);

  const task = readTask(cwd, slug);
  const shortRole = task?.to.replace(/^unfolding-/, "") ?? slug;

  const stream = onUpdate
    ? streamChildSession(session, shortRole, slug, onUpdate, {
      sessionFile: task?.session_file,
      getContextUsage: () => session.getContextUsage(),
      getCost: () => session.getSessionStats().cost,
    })
    : undefined;
  const checkpointRecovery = installCheckpointRecovery(session, cwd, slug, {
    onRecoveryNote: stream?.append,
  });
  let wasLocallyAborted = signal?.aborted === true || parentSignal?.aborted === true;
  const onAbort = () => {
    wasLocallyAborted = true;
    session.abort().catch(() => {});
  };
  try {
    signal?.addEventListener("abort", onAbort);
    parentSignal?.addEventListener("abort", onAbort);

    session.prompt(`${task?.resume_message ?? action}\n\n${CHILD_FIXED_INSTRUCTION}`, { streamingBehavior: "followUp" }).catch((err: unknown) => {
      const stack = err instanceof Error ? err.stack : String(err);
      console.error(`[unfolding] resumed child session for task "${slug}" failed:`, stack);
    });

    let outcome: "finished" | "blocked" | "aborted";
    try {
      outcome = await waitForChildDecision(
        async () => readTask(cwd, slug),
        (_status: string, blocked_reason?: string) => {
          stream?.append(`  ⏸ blocked: ${blocked_reason ?? "(no reason given)"}`);
        },
        undefined,
        signal,
        checkpointRecovery.getFatalError,
        () => wasLocallyAborted,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "FatalChildSessionError") {
        if (wasLocallyAborted) {
          outcome = "aborted";
        } else {
          const detail = error.message.replace(/^fatal child session error in \".*?\":\s*/, "");
          updateTaskStatus(cwd, slug, "blocked", childSessionFailureBlockedReason(detail));
          outcome = "blocked";
        }
      } else {
        throw error;
      }
    }
    if (stream) {
      // Use onUpdate (tool update callback) instead of postOutput to avoid a steer.
      // postOutput → pi.sendMessage while isStreaming=true → steer → extra LLM call →
      // after filterDisplayOnlyMessages the context may end with an assistant message →
      // 400 "does not support assistant message prefill" on Anthropic/Bedrock.
      const finalOutputDetails = { childOutputRole: shortRole, childOutputEvents: stream.getOutputEvents() } satisfies ChildOutputDetails;
      if (outcome === "aborted") {
        await exportDebugHtml?.(cwd, slug);
        (resumeDelegatedTask as any).lastFinalSnapshot = stream.getLines();
        (resumeDelegatedTask as any).lastFinalOutputDetails = finalOutputDetails;
        return outcome;
      }
    } else {
      postOutput(`  💰 $${session.getSessionStats().cost.toFixed(4)} (↑${session.getSessionStats().tokens.input} ↓${session.getSessionStats().tokens.output})`);
    }

    await exportDebugHtml?.(cwd, slug);
    (resumeDelegatedTask as any).lastFinalSnapshot = undefined;
    (resumeDelegatedTask as any).lastFinalOutputDetails = undefined;
    return outcome;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    parentSignal?.removeEventListener("abort", onAbort);
    checkpointRecovery.unsubscribe();
    stream?.unsubscribe();
    await shutdown?.().catch((err: unknown) => {
      console.error(`[unfolding] session_shutdown failed for task "${slug}":`, err);
    });
  }
}
