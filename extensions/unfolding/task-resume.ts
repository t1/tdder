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
  const unsubscribeCheckpointRecovery = installCheckpointRecovery(session, cwd, slug, {
    onRecoveryNote: stream?.append,
  });
  session.prompt(`${task?.resume_message ?? action}\n\n${CHILD_FIXED_INSTRUCTION}`).catch((err: unknown) => {
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
  );
  unsubscribeCheckpointRecovery();
  stream?.unsubscribe();
  const stats = session.getSessionStats();
  const costLine = `  💰 $${stats.cost.toFixed(4)} (↑${stats.tokens.input} ↓${stats.tokens.output})`;
  if (stream) postOutput(stream.getLines() + "\n" + costLine);
  else postOutput(costLine);

  return outcome;
}
