import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const GITIGNORE_RULE = ".pi/unfolding/tasks/";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = "in_progress" | "finished" | "blocked";

export interface TaskInput {
  slug: string;
  from: string;
  to: string;
  body: string;
  references?: string;
  parent_slug?: string;
  session_id?: string;
}

export interface Task extends TaskInput {
  status: TaskStatus;
  blocked_reason?: string;
}

// ---------------------------------------------------------------------------
// ensureGitignore
// ---------------------------------------------------------------------------

export function ensureGitignore(cwd: string): void {
  const path = join(cwd, ".gitignore");
  if (!existsSync(path)) {
    writeFileSync(path, GITIGNORE_RULE + "\n");
    return;
  }
  const content = readFileSync(path, "utf8");
  if (!content.includes(GITIGNORE_RULE)) {
    appendFileSync(path, "\n" + GITIGNORE_RULE + "\n");
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function tasksDir(cwd: string): string {
  return join(cwd, ".pi/unfolding/tasks");
}

function ensureTasksDir(cwd: string): string {
  const dir = tasksDir(cwd);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function serialize(task: Task): string {
  const lines: string[] = [
    `slug: ${task.slug}`,
    `status: ${task.status}`,
    `from: ${task.from}`,
    `to: ${task.to}`,
  ];
  if (task.references)   lines.push(`references: ${task.references}`);
  if (task.parent_slug)  lines.push(`parent_slug: ${task.parent_slug}`);
  if (task.session_id)   lines.push(`session_id: ${task.session_id}`);
  if (task.blocked_reason) lines.push(`blocked_reason: ${task.blocked_reason}`);
  lines.push(`body: |`);
  for (const line of task.body.split("\n")) {
    lines.push(`  ${line}`);
  }
  return lines.join("\n") + "\n";
}

function deserialize(rawContent: string): Task {
  const task: Partial<Task> = {};
  // Extract body block (multi-line literal)
  const bodyMatch = rawContent.match(/^body: \|\n([\s\S]*)$/m);
  const header = bodyMatch ? rawContent.slice(0, rawContent.indexOf("body: |")) : rawContent;
  task.body = bodyMatch ? bodyMatch[1].replace(/^  /gm, "").trimEnd() : "";
  for (const line of header.split("\n")) {
    const m = line.match(/^(\w+): (.+)$/);
    if (!m) continue;
    const [, key, value] = m;
    (task as Record<string, string>)[key] = value;
  }
  return task as Task;
}

function taskFiles(cwd: string): Array<{ file: string; task: Task }> {
  const dir = tasksDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".yaml"))
    .map(f => ({
      file: join(dir, f),
      task: deserialize(readFileSync(join(dir, f), "utf8")),
    }));
}

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

export function createTask(cwd: string, input: TaskInput): Task {
  const existing = taskFiles(cwd).find(({ task }) => task.slug === input.slug);
  if (existing) {
    throw new Error(`Task with slug "${input.slug}" already exists`);
  }
  const task: Task = { ...input, status: "in_progress" };
  const dir = ensureTasksDir(cwd);
  const filename = join(dir, randomUUID() + ".yaml");
  writeFileSync(filename, serialize(task));
  return task;
}

// ---------------------------------------------------------------------------
// readTask
// ---------------------------------------------------------------------------

export function readTask(cwd: string, slug: string): Task | null {
  const found = taskFiles(cwd).find(({ task }) => task.slug === slug);
  return found?.task ?? null;
}

// ---------------------------------------------------------------------------
// listTasks
// ---------------------------------------------------------------------------

export function listTasks(cwd: string): Task[] {
  return taskFiles(cwd).map(({ task }) => task);
}

// ---------------------------------------------------------------------------
// updateTaskStatus
// ---------------------------------------------------------------------------

export function updateTaskStatus(
  cwd: string,
  slug: string,
  status: TaskStatus,
  blocked_reason?: string,
): void {
  const found = taskFiles(cwd).find(({ task }) => task.slug === slug);
  if (!found) throw new Error(`Task "${slug}" not found`);
  const updated: Task = { ...found.task, status };
  if (status === "blocked" && blocked_reason) {
    updated.blocked_reason = blocked_reason;
  } else {
    delete updated.blocked_reason;
  }
  writeFileSync(found.file, serialize(updated));
}

// ---------------------------------------------------------------------------
// deleteTask
// ---------------------------------------------------------------------------

export function deleteTask(cwd: string, slug: string): void {
  const found = taskFiles(cwd).find(({ task }) => task.slug === slug);
  if (!found) throw new Error(`Task "${slug}" not found`);
  unlinkSync(found.file);
}
