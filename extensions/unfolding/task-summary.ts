import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Task } from "./task-store.ts";

function summaryPath(cwd: string): string {
  return join(cwd, ".pi", "unfolding", "tasks.yaml");
}

function ensureSummaryDir(cwd: string): void {
  mkdirSync(join(cwd, ".pi", "unfolding"), { recursive: true });
}

function blockScalar(indent: string, key: string, value: string): string[] {
  return [`${indent}${key}: |`, ...value.split("\n").map(line => `${indent}  ${line}`)];
}

function buildChildrenByParent(tasks: Task[]): Map<string, Task[]> {
  const byParent = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.parent_slug) continue;
    const children = byParent.get(task.parent_slug) ?? [];
    children.push(task);
    byParent.set(task.parent_slug, children);
  }
  return byParent;
}

export function assertValidTaskTree(tasks: Task[]): void {
  if (tasks.length === 0) return;

  const roots = tasks.filter(task => !task.parent_slug);
  if (roots.length !== 1) {
    throw new Error(`Invariant violation: expected exactly 1 top-level task, found ${roots.length}. Stop and report the corrupted task state to the user.`);
  }

  const bySlug = new Map(tasks.map(task => [task.slug, task]));
  const childrenByParent = buildChildrenByParent(tasks);

  for (const task of tasks) {
    if (!task.parent_slug) continue;
    const parent = bySlug.get(task.parent_slug);
    if (!parent) {
      throw new Error(`Invariant violation: task "${task.slug}" references missing parent "${task.parent_slug}". Stop and report the corrupted task state to the user.`);
    }
    if (task.from !== parent.to) {
      throw new Error(`Invariant violation: task "${task.slug}" is delegated from "${task.from}", but its parent role is "${parent.to}". Stop and report the corrupted task state to the user.`);
    }
  }

  for (const [parentSlug, delegates] of childrenByParent.entries()) {
    if (delegates.length > 1) {
      throw new Error(`Invariant violation: task "${parentSlug}" has ${delegates.length} direct delegates. Stop and report the corrupted task state to the user.`);
    }
  }
}

export function assertValidRootWorkflow(tasks: Task[]): void {
  if (tasks.length === 0) return;
  assertValidTaskTree(tasks);
  const root = tasks.find(task => !task.parent_slug)!;
  if (root.from !== "orchestrator" || root.to !== "po") {
    throw new Error(`Invariant violation: top-level task must be orchestrator -> po, found ${root.from} -> ${root.to}. Stop and report the corrupted task state to the user.`);
  }
}

function renderNode(task: Task, childrenByParent: Map<string, Task[]>, indent = ""): string[] {
  const lines = [
    `${indent}slug: ${task.slug}`,
    `${indent}role: ${task.to}`,
  ];
  if (task.session_id) lines.push(`${indent}session_id: ${task.session_id}`);
  lines.push(`${indent}status: ${task.status}`);
  if (task.blocked_reason) lines.push(...blockScalar(indent, "blocked_reason", task.blocked_reason));

  const delegates = childrenByParent.get(task.slug) ?? [];
  if (delegates.length > 1) {
    throw new Error(`Invariant violation: task "${task.slug}" has ${delegates.length} direct delegates. Call task_block and report the corrupted task state to your commissioner.`);
  }
  const delegate = delegates[0];
  if (delegate) {
    lines.push(`${indent}delegate:`);
    lines.push(...renderNode(delegate, childrenByParent, `${indent}  `));
  }
  return lines;
}

function renderSummary(tasks: Task[]): string {
  assertValidRootWorkflow(tasks);
  const root = tasks.find(task => !task.parent_slug)!;
  return renderNode(root, buildChildrenByParent(tasks)).join("\n") + "\n";
}

export function writeTaskSummary(cwd: string, tasks: Task[]): void {
  const path = summaryPath(cwd);
  if (tasks.length === 0) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }

  try {
    assertValidRootWorkflow(tasks);
  } catch {
    if (existsSync(path)) unlinkSync(path);
    return;
  }

  ensureSummaryDir(cwd);
  writeFileSync(path, renderSummary(tasks));
}
