import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";


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
  resume_message?: string;
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
  if (task.references)    lines.push(`references: ${task.references}`);
  if (task.parent_slug)   lines.push(`parent_slug: ${task.parent_slug}`);
  if (task.session_id)    lines.push(`session_id: ${task.session_id}`);
  if (task.blocked_reason) lines.push(...blockScalar("blocked_reason", task.blocked_reason));
  if (task.resume_message)  lines.push(...blockScalar("resume_message",  task.resume_message));
  lines.push(...blockScalar("body", task.body));
  return lines.join("\n") + "\n";
}

function blockScalar(key: string, value: string): string[] {
  return [`${key}: |`, ...value.split("\n").map(l => `  ${l}`)];
}

function deserialize(rawContent: string): Task {
  const task: Partial<Task> = {};
  // Parse scalar fields and block scalars (key: |\n  indented lines)
  const blockRe = /^(\w+): \|\n((?:  [^\n]*\n?)*)/gm;
  const consumed = new Set<string>();
  for (const m of rawContent.matchAll(blockRe)) {
    const [, key, indented] = m;
    (task as Record<string, string>)[key] = indented.replace(/^  /gm, "").trimEnd();
    consumed.add(key);
  }
  for (const line of rawContent.split("\n")) {
    const m = line.match(/^(\w+): (.+)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (!consumed.has(key)) (task as Record<string, string>)[key] = value;
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
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 6);
  const filename = join(dir, `${ts}-${rand}.yaml`);
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
  resume_message?: string,
): void {
  const found = taskFiles(cwd).find(({ task }) => task.slug === slug);
  if (!found) throw new Error(`Task "${slug}" not found`);
  const updated: Task = { ...found.task, status };
  if (status === "blocked" && blocked_reason) {
    updated.blocked_reason = blocked_reason;
  } else {
    delete updated.blocked_reason;
  }
  if (resume_message) {
    updated.resume_message = resume_message;
  } else {
    delete updated.resume_message;
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
