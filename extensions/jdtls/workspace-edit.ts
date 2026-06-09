/**
 * LSP WorkspaceEdit / TextEdit applier.
 *
 * Pure functions (easy to test):
 *   - applyTextEdits            — apply a list of TextEdits to a string
 *   - collectEditsFromWorkspaceEdit — extract URI→TextEdit[] from either
 *                                     WorkspaceEdit wire format
 *   - formatApplyResult         — human-readable summary of what changed
 *
 * Impure function (reads / writes disk):
 *   - applyWorkspaceEdit        — orchestrates the above
 */

import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// LSP types (subset)
// ---------------------------------------------------------------------------

export interface TextEdit {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
}

export interface WorkspaceEdit {
  /** Old-style wire format. */
  changes?: Record<string, TextEdit[]>;
  /** New-style wire format (may also include CreateFile / DeleteFile — ignored). */
  documentChanges?: Array<{
    textDocument: { uri: string };
    edits: TextEdit[];
  }>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Return the absolute byte offset in `content` corresponding to the given
 * 0-based LSP line/character position.
 *
 * LSP characters are UTF-16 code units; JavaScript strings are also UTF-16,
 * so the arithmetic matches for all BMP characters (the common case in Java).
 */
function offsetOf(content: string, line: number, character: number): number {
  let lineStart = 0;
  for (let l = 0; l < line; l++) {
    const next = content.indexOf("\n", lineStart);
    if (next === -1) return content.length; // past end — clamp
    lineStart = next + 1;
  }
  return lineStart + character;
}

/**
 * Apply a list of (possibly overlapping-free) TextEdits to `content`.
 * Edits are applied in reverse positional order so earlier offsets stay valid.
 */
export function applyTextEdits(content: string, edits: TextEdit[]): string {
  if (edits.length === 0) return content;

  // Reverse sort: last position in the file first.
  const sorted = [...edits].sort((a, b) => {
    const ld = b.range.start.line - a.range.start.line;
    return ld !== 0 ? ld : b.range.start.character - a.range.start.character;
  });

  let result = content;
  for (const edit of sorted) {
    const start = offsetOf(result, edit.range.start.line, edit.range.start.character);
    const end = offsetOf(result, edit.range.end.line, edit.range.end.character);
    result = result.slice(0, start) + edit.newText + result.slice(end);
  }
  return result;
}

/**
 * Normalise either WorkspaceEdit wire format into a Map<uri, TextEdit[]>.
 * CreateFile / RenameFile / DeleteFile resource operations are ignored for now.
 */
export function collectEditsFromWorkspaceEdit(
  edit: WorkspaceEdit,
): Map<string, TextEdit[]> {
  const map = new Map<string, TextEdit[]>();

  if (edit.documentChanges) {
    for (const dc of edit.documentChanges) {
      // Skip resource operations (no `edits` field).
      if (!("edits" in dc)) {
        const kind = (dc as { kind?: string }).kind ?? "unknown";
        console.warn(`[jdtls] skipping unsupported resource operation: ${kind}`);
        continue;
      }
      const prev = map.get(dc.textDocument.uri) ?? [];
      map.set(dc.textDocument.uri, [...prev, ...dc.edits]);
    }
  } else if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      map.set(uri, edits);
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Result type + formatting
// ---------------------------------------------------------------------------

export interface FileChangeResult {
  path: string;
  editsApplied: number;
}

/** Format the list of changed files for display. `action` is e.g. "Renamed 'Foo' → 'Bar'". */
export function formatApplyResult(
  results: FileChangeResult[],
  cwd: string,
  action: string,
): string {
  if (results.length === 0) return `${action} — no changes needed`;

  const total = results.reduce((s, r) => s + r.editsApplied, 0);
  const fileLine = `${results.length} file${results.length > 1 ? "s" : ""}`;
  const editLine = `${total} edit${total !== 1 ? "s" : ""}`;
  const lines = [`${action} — ${fileLine} changed (${editLine} total):`, ""];

  const nameWidth = Math.max(...results.map((r) => relative(cwd, r.path).length));
  for (const r of results) {
    const rel = relative(cwd, r.path);
    const count = `(${r.editsApplied} edit${r.editsApplied !== 1 ? "s" : ""})`;
    lines.push(`  ${rel.padEnd(nameWidth)}  ${count}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Impure applier
// ---------------------------------------------------------------------------

/**
 * Apply a WorkspaceEdit to disk.
 * Returns a summary of every file that was written.
 */
export function applyWorkspaceEdit(
  edit: WorkspaceEdit,
): FileChangeResult[] {
  const byUri = collectEditsFromWorkspaceEdit(edit);
  const results: FileChangeResult[] = [];

  for (const [uri, edits] of byUri) {
    const filePath = fileURLToPath(uri);
    const original = readFileSync(filePath, "utf-8");
    const updated = applyTextEdits(original, edits);
    if (updated !== original) {
      writeFileSync(filePath, updated, "utf-8");
    }
    results.push({ path: filePath, editsApplied: edits.length });
  }

  return results;
}
