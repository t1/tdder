/**
 * Types and pure formatting helpers for textDocument/codeAction.
 *
 * LSP mixes two distinct shapes in the same array:
 *
 *   Command    { title, command: string, arguments? }
 *   CodeAction { title, kind?, edit?, command?: Command }
 *
 * The key runtime distinction: a Command has `command` as a bare string;
 * a CodeAction has `command` as a nested object (or no `command` at all).
 */

import type { WorkspaceEdit } from "./workspace-edit.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LspCommand {
  title: string;
  command: string;
  arguments?: unknown[];
}

export interface LspCodeAction {
  title: string;
  kind?: string;
  edit?: WorkspaceEdit;
  command?: LspCommand;
  /** Unresolved action — server may need a separate resolve round-trip. */
  data?: unknown;
}

export type LspAction = LspCommand | LspCodeAction;

/** True when the item is a bare Command (not a CodeAction). */
export function isCommand(action: LspAction): action is LspCommand {
  return (
    typeof (action as LspCommand).command === "string" &&
    !("kind" in action) &&
    !("edit" in action)
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Format a codeAction list for the LLM to read and pick from. */
export function formatCodeActions(actions: LspAction[]): string {
  if (actions.length === 0) {
    return "No code actions available at this position.";
  }

  const lines = [
    `${actions.length} code action${actions.length !== 1 ? "s" : ""} available:`,
    "",
  ];

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const kind = !isCommand(a) && a.kind ? ` [${a.kind}]` : "";
    lines.push(`  ${i}.  ${a.title}${kind}`);
  }

  lines.push(
    "",
    "To apply one, call code_action again with applyTitle set to the exact title string.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Source-path formatting (used by get_project_modules)
// ---------------------------------------------------------------------------

export interface LspSourcePath {
  displayPath: string;
  projectName: string;
  projectType?: string;
  kind: number; // 1 = source, 2 = test
}

/** Format workspace/executeCommand `java.project.listSourcePaths` result. */
export function formatSourcePaths(paths: LspSourcePath[]): string {
  if (paths.length === 0) return "No source paths found in this workspace.";

  // Group by project name.
  const byProject = new Map<string, { type?: string; src: string[]; test: string[] }>();
  for (const p of paths) {
    if (!byProject.has(p.projectName)) {
      byProject.set(p.projectName, { type: p.projectType, src: [], test: [] });
    }
    const entry = byProject.get(p.projectName)!;
    if (p.kind === 2) entry.test.push(p.displayPath);
    else entry.src.push(p.displayPath);
  }

  const lines: string[] = [`Modules (${byProject.size}):`, ""];
  for (const [name, info] of byProject) {
    const typeStr = info.type ? ` (${info.type})` : "";
    lines.push(`  ${name}${typeStr}`);
    if (info.src.length > 0) lines.push(`    src:   ${info.src.join(", ")}`);
    if (info.test.length > 0) lines.push(`    test:  ${info.test.join(", ")}`);
  }
  return lines.join("\n");
}
