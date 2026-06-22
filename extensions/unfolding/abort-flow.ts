import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { taskList } from "./task-tools.ts";

export async function abortAllActiveSessions(activeSessions: Map<string, AgentSession>): Promise<void> {
  const sessions = [...activeSessions.values()];
  await Promise.all(sessions.map(session => session.abort().catch(() => {})));
  activeSessions.clear();
}

export function renderAbortSummary(cwd: string, reason: string, activeSessions: Map<string, AgentSession>): string {
  const tasks = taskList(cwd, "*", activeSessions as any);
  return [
    "  ⛔ unfolding aborted",
    `  reason: ${reason}`,
    "  task statuses below are the last persisted snapshot:",
    ...tasks.split("\n").map(line => `  ${line}`),
  ].join("\n");
}
