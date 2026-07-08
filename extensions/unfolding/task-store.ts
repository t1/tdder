import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { assertValidTaskTree, writeTaskSummary } from "./task-summary.ts";


const GITIGNORE_RULES = [
  ".pi/unfolding/tasks/",
  ".pi/unfolding/exports/",
] as const;

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
  session_file?: string;
  base_sha?: string;
  snapshot_sha?: string;
}

export interface Task extends TaskInput {
  status: TaskStatus;
  blocked_reason?: string;
  resume_message?: string;
}

// ---------------------------------------------------------------------------
// ensureGitExclude
// ---------------------------------------------------------------------------

export function ensureGitExclude(cwd: string): void {
  const path = join(cwd, ".git", "info", "exclude");
  if (!existsSync(path)) return;
  let content = readFileSync(path, "utf8");
  for (const rule of GITIGNORE_RULES) {
    if (!content.includes(rule)) {
      const addition = (content.endsWith("\n") ? "" : "\n") + rule + "\n";
      appendFileSync(path, addition);
      content += addition;
    }
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

function taskFilename(cwd: string, slug: string): string {
  return join(ensureTasksDir(cwd), `${slug}.yaml`);
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
  if (task.session_file)  lines.push(`session_file: ${task.session_file}`);
  if (task.base_sha)      lines.push(`base_sha: ${task.base_sha}`);
  if (task.snapshot_sha)  lines.push(`snapshot_sha: ${task.snapshot_sha}`);
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
    .sort()
    .map(f => ({
      file: join(dir, f),
      task: deserialize(readFileSync(join(dir, f), "utf8")),
    }));
}

function rewriteSummary(cwd: string): void {
  const tasks = listTasks(cwd);
  if (tasks.length === 0) {
    writeTaskSummary(cwd, tasks);
    return;
  }

  const roots = tasks.filter(task => !task.parent_slug);
  if (roots.length === 1 && roots[0]?.from === "orchestrator") {
    assertValidTaskTree(tasks);
    writeTaskSummary(cwd, tasks);
    return;
  }

  writeTaskSummary(cwd, []);
}

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

export function createTask(cwd: string, input: TaskInput): Task {
  ensureGitExclude(cwd);
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
  rewriteSummary(cwd);
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

export function listDirectDelegates(cwd: string, from: string, parentSlug?: string): Task[] {
  return listTasks(cwd).filter(task =>
    parentSlug
      ? task.parent_slug === parentSlug
      : task.from === from && !task.parent_slug,
  );
}

export function getSingleDirectDelegate(cwd: string, from: string, parentSlug?: string): Task | null {
  const delegates = listDirectDelegates(cwd, from, parentSlug);
  if (delegates.length === 0) return null;
  if (delegates.length > 1) {
    throw new Error("Invariant violation: multiple direct delegates exist. Call task_block and report the corrupted task state to your commissioner.");
  }
  return delegates[0]!;
}

export type DirectDelegateClassification =
  | { kind: "none" }
  | { kind: "in_progress" | "blocked" | "finished"; task: Task };

export function classifyDirectDelegate(cwd: string, from: string, parentSlug?: string): DirectDelegateClassification {
  const delegate = getSingleDirectDelegate(cwd, from, parentSlug);
  if (!delegate) return { kind: "none" };
  return { kind: delegate.status, task: delegate };
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
  rewriteSummary(cwd);
}

// ---------------------------------------------------------------------------
// deleteTask
// ---------------------------------------------------------------------------

export function deleteTask(cwd: string, slug: string): void {
  const found = taskFiles(cwd).find(({ task }) => task.slug === slug);
  if (!found) throw new Error(`Task "${slug}" not found`);
  unlinkSync(found.file);
  rewriteSummary(cwd);
}
