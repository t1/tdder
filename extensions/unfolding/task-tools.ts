import { readTask, listTasks, updateTaskStatus, deleteTask } from "./task-store.ts";
import type { Task } from "./task-store.ts";

function formatTask(task: Task): string {
  return `- [${task.status}] ${task.slug} → ${task.to}`;
}

export function taskList(cwd: string): string {
  const tasks = listTasks(cwd);
  if (tasks.length === 0) return "No delegated tasks.";
  return tasks.map(formatTask).join("\n");
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
  if (task.blocked_reason) lines.push(`blocked_reason: ${task.blocked_reason}`);
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

export function taskReopen(cwd: string, slug: string, _reason: string): void {
  // reason is passed to the child session resume message (not yet implemented)
  updateTaskStatus(cwd, slug, "in_progress");
}

export function taskUnblock(cwd: string, slug: string, _reason?: string): void {
  // reason is passed to the child session resume message (not yet implemented)
  updateTaskStatus(cwd, slug, "in_progress");
}
