import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { taskList } from "./task-tools.ts";
import { listTasks, readTask } from "./task-store.ts";

export interface AbortActiveSessionsOptions {
  skipSlugs?: Iterable<string>;
}

export async function abortAllActiveSessions(
  activeSessions: Map<string, AgentSession>,
  options: AbortActiveSessionsOptions = {},
): Promise<void> {
  const skipSlugs = new Set(options.skipSlugs ?? []);
  const sessions = [...activeSessions.entries()]
    .filter(([slug]) => !skipSlugs.has(slug))
    .map(([, session]) => session);
  await Promise.all(sessions.map(async session => {
    if (typeof session.abort !== "function") return;
    await session.abort().catch(() => {
    });
  }));
  activeSessions.clear();
}

function withAncestorSkips(cwd: string, options: AbortActiveSessionsOptions = {}): AbortActiveSessionsOptions {
  const skipSlugs = new Set(options.skipSlugs ?? []);
  for (const slug of [...skipSlugs]) {
    let current = readTask(cwd, slug)?.parent_slug;
    while (current && !skipSlugs.has(current)) {
      skipSlugs.add(current);
      current = readTask(cwd, current)?.parent_slug;
    }
  }
  return { ...options, skipSlugs };
}

export async function abortSessionStack(
  cwd: string,
  reason: string,
  activeSessions: Map<string, AgentSession>,
  postOutput?: (lines: string) => void,
  options: AbortActiveSessionsOptions = {},
): Promise<string> {
  const snapshot = new Map(activeSessions);
  const summary = renderAbortSummary(cwd, reason, snapshot);
  postOutput?.(summary);
  await abortAllActiveSessions(activeSessions, withAncestorSkips(cwd, options));
  return summary;
}

function renderAbortStacks(cwd: string, activeSessions: Map<string, AgentSession>): string[] {
  const activeSlugs = new Set(activeSessions.keys());
  if (activeSlugs.size === 0) return [];

  const tasksBySlug = new Map(
    listTasks(cwd)
      .filter(task => activeSlugs.has(task.slug))
      .map(task => [task.slug, task] as const),
  );

  const roots = [...tasksBySlug.values()]
    .filter(task => !task.parent_slug || !tasksBySlug.has(task.parent_slug))
    .map(task => task.slug)
    .sort();

  const lines: string[] = ["  active task stack(s) being aborted:"];
  for (const root of roots) {
    const chain: string[] = [];
    let current = root;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      chain.push(current);
      const child = [...tasksBySlug.values()]
        .filter(task => task.parent_slug === current)
        .map(task => task.slug)
        .sort()[0];
      if (!child) break;
      current = child;
    }
    lines.push(`  - ${chain.join(" -> ")}`);
  }
  return lines;
}

export function renderAbortSummary(cwd: string, reason: string, activeSessions: Map<string, AgentSession>): string {
  const tasks = taskList(cwd, "*", activeSessions as any);
  const abortStacks = renderAbortStacks(cwd, activeSessions);
  return [
    "  ⛔ unfolding aborted",
    `  reason: ${reason}`,
    ...abortStacks,
    "  task statuses below are the last persisted snapshot:",
    ...tasks.split("\n").map(line => `  ${line}`),
  ].join("\n");
}
