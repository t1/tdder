import { resolve } from "node:path";
import type { TSchema } from "typebox";
import { Type } from "typebox";
import { loadAgentRoleConfig } from "./task-delegate.ts";
import type { Task } from "./task-store.ts";

function rolesDir(): string {
  return resolve(new URL(import.meta.url).pathname, "..", "roles");
}

function normalizeRole(role: string): string {
  return role.replace(/^unfolding-/, "");
}

function loadDelegatesTo(role: string): string[] | undefined {
  return loadAgentRoleConfig(rolesDir(), normalizeRole(role))?.delegatesTo;
}

export function allowedDelegatesForRole(role: string): string[] | undefined {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "orchestrator") return ["po"];
  return loadDelegatesTo(normalizedRole)?.map(normalizeRole);
}

export function delegateRoleParameterSchema(from: string): TSchema {
  const allowed = allowedDelegatesForRole(from);
  if (!allowed || allowed.length === 0) {
    return Type.String({ description: "Role to delegate to" });
  }
  if (allowed.length === 1) {
    return Type.Literal(allowed[0]!, { description: `Role to delegate to (${allowed[0]})` });
  }
  return Type.Union(
    allowed.map(role => Type.Literal(role)),
    { description: `Role to delegate to (${allowed.join(", ")})` },
  );
}

export function assertDelegationAllowed(from: string, to: string): void {
  const normalizedFrom = normalizeRole(from);
  const normalizedTo = normalizeRole(to);
  const allowed = allowedDelegatesForRole(normalizedFrom);
  if (!allowed) {
    throw new Error(`Invariant violation: role "${normalizedFrom}" does not declare delegates-to in its role frontmatter. Stop and report the corrupted task state to the user.`);
  }
  if (!allowed.includes(normalizedTo)) {
    const allowedText = allowed.length === 0 ? "(none)" : allowed.join(", ");
    throw new Error(`Delegation policy violation: role "${normalizedFrom}" may not delegate to "${normalizedTo}". Allowed delegate roles: ${allowedText}.`);
  }
}

export function assertTaskDelegationPolicy(task: Task): void {
  assertDelegationAllowed(task.from, task.to);
}
