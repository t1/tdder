import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
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
  recreate_message?: string;
  resume_message?: string;
}

interface TaskRecord {
  filename: string;
  task: Task;
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

function unfoldingDir(cwd: string): string {
  return join(cwd, ".pi", "unfolding");
}

function tasksDir(cwd: string): string {
  return join(unfoldingDir(cwd), "tasks");
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
  if (task.session_file)  lines.push(`session_file: ${task.session_file}`);
  if (task.base_sha)      lines.push(`base_sha: ${task.base_sha}`);
  if (task.snapshot_sha)  lines.push(`snapshot_sha: ${task.snapshot_sha}`);
  if (task.blocked_reason)  lines.push(...blockScalar("blocked_reason", task.blocked_reason));
  if (task.recreate_message) lines.push(...blockScalar("recreate_message", task.recreate_message));
  if (task.resume_message)   lines.push(...blockScalar("resume_message",  task.resume_message));
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

function taskFiles(cwd: string): TaskRecord[] {
  const dir = tasksDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".yaml"))
    .sort()
    .map(filename => ({
      filename,
      task: deserialize(readFileSync(join(dir, filename), "utf8")),
    }));
}

function shouldValidateTaskTree(tasks: Task[]): boolean {
  if (tasks.length === 0) return false;
  const roots = tasks.filter(task => !task.parent_slug);
  return roots.length === 1 && roots[0]?.from === "orchestrator";
}

function validateProspectiveTasks(tasks: Task[]): void {
  const bySlug = new Map(tasks.map(task => [task.slug, task]));
  const childrenByParent = new Map<string, Task[]>();

  for (const task of tasks) {
    if (!task.parent_slug) continue;
    const parent = bySlug.get(task.parent_slug);
    if (!parent) {
      throw new Error(`Invariant violation: task "${task.slug}" references missing parent "${task.parent_slug}". Stop and report the corrupted task state to the user.`);
    }
    if (task.from !== parent.to) {
      throw new Error(`Invariant violation: task "${task.slug}" is delegated from "${task.from}", but its parent role is "${parent.to}". Stop and report the corrupted task state to the user.`);
    }
    const delegates = childrenByParent.get(task.parent_slug) ?? [];
    delegates.push(task);
    childrenByParent.set(task.parent_slug, delegates);
  }

  for (const [parentSlug, delegates] of childrenByParent.entries()) {
    if (delegates.length > 1) {
      throw new Error(`Invariant violation: task "${parentSlug}" has ${delegates.length} direct delegates. Stop and report the corrupted task state to the user.`);
    }
  }
}

function rewriteSummaryFromTasks(cwd: string, tasks: Task[]): void {
  if (tasks.length === 0) {
    writeTaskSummary(cwd, tasks);
    return;
  }

  if (shouldValidateTaskTree(tasks)) {
    writeTaskSummary(cwd, tasks);
    return;
  }

  writeTaskSummary(cwd, []);
}

function generateOpaqueFilename(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}.yaml`;
}

function persistTaskRecords(cwd: string, records: TaskRecord[]): void {
  const normalized = records.map(({ filename, task }) => ({ filename, task }));
  const tasks = normalized.map(({ task }) => task);
  validateProspectiveTasks(tasks);

  mkdirSync(unfoldingDir(cwd), { recursive: true });
  const dir = tasksDir(cwd);
  const token = Math.random().toString(36).slice(2, 8);
  const tempDir = join(unfoldingDir(cwd), `tasks.tmp-${token}`);
  const backupDir = join(unfoldingDir(cwd), `tasks.bak-${token}`);
  const hadDir = existsSync(dir);

  mkdirSync(tempDir, { recursive: true });
  for (const { filename, task } of normalized) {
    writeFileSync(join(tempDir, filename), serialize(task));
  }

  try {
    if (hadDir) renameSync(dir, backupDir);
    renameSync(tempDir, dir);
    if (hadDir) rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
    if (hadDir && existsSync(backupDir) && !existsSync(dir)) renameSync(backupDir, dir);
    throw error;
  }

  rewriteSummaryFromTasks(cwd, tasks);
}

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

export function createTask(cwd: string, input: TaskInput): Task {
  ensureGitExclude(cwd);
  const records = taskFiles(cwd);
  const existing = records.find(({ task }) => task.slug === input.slug);
  if (existing) {
    throw new Error(`Task with slug "${input.slug}" already exists`);
  }
  const task: Task = { ...input, status: "in_progress" };
  persistTaskRecords(cwd, [...records, { filename: generateOpaqueFilename(), task }]);
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
  recreate_message?: string,
): void {
  const records = taskFiles(cwd);
  const found = records.find(({ task }) => task.slug === slug);
  if (!found) throw new Error(`Task "${slug}" not found`);
  const updated: Task = { ...found.task, status };
  if (status === "blocked" && blocked_reason) {
    updated.blocked_reason = blocked_reason;
  } else {
    delete updated.blocked_reason;
  }
  if (status === "blocked" && recreate_message) {
    updated.recreate_message = recreate_message;
  } else {
    delete updated.recreate_message;
  }
  if (resume_message) {
    updated.resume_message = resume_message;
  } else {
    delete updated.resume_message;
  }
  persistTaskRecords(cwd, records.map(record =>
    record.task.slug === slug
      ? { ...record, task: updated }
      : record,
  ));
}

export function recreateTaskSession(
  cwd: string,
  slug: string,
  session_id: string,
  session_file: string,
  resume_message: string,
): void {
  const records = taskFiles(cwd);
  const found = records.find(({ task }) => task.slug === slug);
  if (!found) throw new Error(`Task "${slug}" not found`);
  const updated: Task = {
    ...found.task,
    status: "in_progress",
    session_id,
    session_file,
    resume_message,
  };
  delete updated.blocked_reason;
  delete updated.recreate_message;
  persistTaskRecords(cwd, records.map(record =>
    record.task.slug === slug
      ? { ...record, task: updated }
      : record,
  ));
}

// ---------------------------------------------------------------------------
// deleteTask
// ---------------------------------------------------------------------------

export function deleteTask(cwd: string, slug: string): void {
  const records = taskFiles(cwd);
  const found = records.find(({ task }) => task.slug === slug);
  if (!found) throw new Error(`Task "${slug}" not found`);
  persistTaskRecords(cwd, records.filter(record => record.task.slug !== slug));
}
