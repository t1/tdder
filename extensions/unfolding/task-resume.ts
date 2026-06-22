import type { Model } from "@earendil-works/pi-ai";
import type { AgentSession, AgentToolUpdateCallback, ExtensionAPI, AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { readTask } from "./task-store.ts";
import { installCheckpointRecovery, streamChildSession, waitForChildDecision, CHILD_FIXED_INSTRUCTION } from "./task-delegate.ts";
import { restoreChildSession } from "./session-restore.ts";
import { makeTaskDelegateDefinition } from "./task-delegate-tool.ts";

export interface ResumeDelegatedTaskParams {
  action: "reopen" | "unblock";
  cwd: string;
  slug: string;
  reason?: string;
  activeSessions: Map<string, AgentSession>;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<unknown>;
  postOutput: (lines: string) => void;
  mutateTask: (cwd: string, slug: string, reason?: string) => void;
  pi: ExtensionAPI;
  model?: Model<any>;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
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
  onUpdate,
  postOutput,
  mutateTask,
  pi,
  model,
  authStorage,
  modelRegistry,
}: ResumeDelegatedTaskParams): Promise<"finished" | "blocked" | "aborted"> {
  let session = activeSessions.get(slug);
  if (!session) {
    session = await restoreChildSession(
      cwd,
      slug,
      activeSessions,
      pi,
      postOutput,
      (shortRole: string) => makeTaskDelegateDefinition(shortRole, activeSessions, pi, postOutput),
      model,
      authStorage,
      modelRegistry,
    );
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
    ? streamChildSession(session, shortRole, slug, onUpdate, { sessionFile: task?.session_file })
    : undefined;
  const checkpointRecovery = installCheckpointRecovery(session, cwd, slug, {
    onRecoveryNote: stream?.append,
  });
  try {
    session.prompt(`${task?.resume_message ?? action}\n\n${CHILD_FIXED_INSTRUCTION}`, { streamingBehavior: "followUp" }).catch((err: unknown) => {
      const stack = err instanceof Error ? err.stack : String(err);
      console.error(`[unfolding] resumed child session for task "${slug}" failed:`, stack);
    });

    const outcome = await waitForChildDecision(
      async () => readTask(cwd, slug),
      (_status: string, blocked_reason?: string) => {
        stream?.append(`  ⏸ blocked: ${blocked_reason ?? "(no reason given)"}`);
      },
      undefined,
      signal,
      checkpointRecovery.getFatalError,
    );
    const stats = session.getSessionStats();
    const costLine = `  💰 $${stats.cost.toFixed(4)} (↑${stats.tokens.input} ↓${stats.tokens.output})`;
    if (stream) {
      const finalSnapshot = stream.getLines() + "\n" + costLine;
      // Use onUpdate (tool update callback) instead of postOutput to avoid a steer.
      // postOutput → pi.sendMessage while isStreaming=true → steer → extra LLM call →
      // after filterDisplayOnlyMessages the context may end with an assistant message →
      // 400 "does not support assistant message prefill" on Anthropic/Bedrock.
      onUpdate?.({ content: [{ type: "text", text: finalSnapshot }], details: undefined });
      if (outcome === "aborted") {
        // User-triggered abort clears transient tool-update UI. Re-post the final child snapshot
        // as a display-only custom message so the nested transcript stays visible like a normal run.
        postOutput(finalSnapshot);
      }
    } else {
      postOutput(costLine);
    }

    return outcome;
  } finally {
    checkpointRecovery.unsubscribe();
    stream?.unsubscribe();
  }
}
