import type { AgentSession, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { readTask } from "./task-store.ts";
import { streamChildSession, waitForChildDecision } from "./task-delegate.ts";

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
}

function missingSessionMessage(action: "reopen" | "unblock", slug: string): string {
  return (
    `task_${action}: no live session found for slug "${slug}". ` +
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
}: ResumeDelegatedTaskParams): Promise<"finished" | "blocked" | "aborted"> {
  const session = activeSessions.get(slug);
  if (!session) {
    const message = missingSessionMessage(action, slug);
    postOutput(`  ⚠ ${message}`);
    throw new Error(message);
  }

  mutateTask(cwd, slug, reason);

  const task = readTask(cwd, slug);
  const shortRole = task?.to.replace(/^unfolding-/, "") ?? slug;

  const stream = onUpdate
    ? streamChildSession(session, shortRole, slug, onUpdate)
    : undefined;

  const outcome = await waitForChildDecision(
    async () => readTask(cwd, slug),
    (_status: string, blocked_reason?: string) => {
      stream?.append(`  ⏸ blocked: ${blocked_reason ?? "(no reason given)"}`);
    },
    undefined,
    signal,
  );
  stream?.unsubscribe();
  const stats = session.getSessionStats();
  const costLine = `  💰 $${stats.cost.toFixed(4)} (↑${stats.tokens.input} ↓${stats.tokens.output})`;
  if (stream) postOutput(stream.getLines() + "\n" + costLine);
  else postOutput(costLine);

  return outcome;
}
