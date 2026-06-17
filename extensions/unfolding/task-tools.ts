import { restoreTaskWorkspace } from "./git-task-state.ts";
import { readTask, listTasks, updateTaskStatus, deleteTask } from "./task-store.ts";
import type { Task } from "./task-store.ts";

export interface SessionLike {
  getSessionStats(): { cost: number; tokens: { input: number; output: number } };
}

function formatTask(task: Task, session?: SessionLike): string {
  const parts = [`- [${task.status}] ${task.slug} → ${task.to}`];
  if (task.blocked_reason) parts.push(`  blocked: ${task.blocked_reason}`);
  if (session) {
    const stats = session.getSessionStats();
    parts.push(`  live 💰 $${stats.cost.toFixed(4)} (↑${stats.tokens.input} ↓${stats.tokens.output})`);
  }
  return parts.join("\n");
}

export function taskList(cwd: string, from = "orchestrator", activeSessions?: Map<string, SessionLike>): string {
  const all = listTasks(cwd);
  const tasks = from === "*" ? all : all.filter(t => t.from === from);
  if (tasks.length === 0) return "No delegated tasks.";
  return tasks.map(t => formatTask(t, activeSessions?.get(t.slug))).join("\n");
}

export function taskRead(cwd: string, slug: string): string {
  const task = readTask(cwd, slug);
  if (!task) throw new Error(`Task "${slug}" not found`);
  const lines = [
    `slug: ${task.slug}`,
    `status: ${task.status}`,
    `from: ${task.from}`,
    `to: ${task.to}`,
  ];
  if (task.references)    lines.push(`references: ${task.references}`);
  if (task.parent_slug)   lines.push(`parent_slug: ${task.parent_slug}`);
  if (task.session_id)    lines.push(`session_id: ${task.session_id}`);
  if (task.session_file)  lines.push(`session_file: ${task.session_file}`);
  if (task.blocked_reason) lines.push(`blocked_reason: |\n${task.blocked_reason.split("\n").map(l => `  ${l}`).join("\n")}`);
  if (task.resume_message)  lines.push(`resume_message: |\n${task.resume_message.split("\n").map(l => `  ${l}`).join("\n")}`);
  lines.push(`\nbody:\n${task.body}`);
  return lines.join("\n");
}

export function taskFinished(cwd: string, slug: string): void {
  updateTaskStatus(cwd, slug, "finished");
}

export function taskBlock(cwd: string, slug: string, reason: string | undefined): void {
  if (!reason) throw new Error("blocked_reason is required when blocking a task");
  updateTaskStatus(cwd, slug, "blocked", reason);
}

export function taskAccept(cwd: string, slug: string): void {
  deleteTask(cwd, slug);
}

export function taskRollback(cwd: string, slug: string): void {
  const task = readTask(cwd, slug);
  if (!task) throw new Error(`Task "${slug}" not found`);
  if (!task.base_sha) throw new Error(`Task "${slug}" has no base_sha for rollback`);

  deleteTask(cwd, slug);
  restoreTaskWorkspace(cwd, task.base_sha, task.snapshot_sha);
}

export function taskReopen(cwd: string, slug: string, reason: string): void {
  updateTaskStatus(cwd, slug, "in_progress", undefined, `reopened: ${reason}`);
}

export function taskUnblock(cwd: string, slug: string, reason?: string): void {
  const msg = reason ? `unblocked: ${reason}` : "unblocked";
  updateTaskStatus(cwd, slug, "in_progress", undefined, msg);
}
