/**
 * Pure formatting helpers for LSP response types.
 *
 * - formatHover   — textDocument/hover (old MarkedString format)
 * - formatSymbols — workspace/symbol (SymbolInformation[])
 *
 * Both are pure functions: easy to unit-test, no side effects.
 */

import { relative } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

// jdtls uses the legacy MarkedString format, not MarkupContent.
type MarkedString = string | { language: string; value: string };
type HoverContents = MarkedString | MarkedString[];

/**
 * Format a textDocument/hover result into readable text.
 * Returns a fallback string when the result is null or empty.
 */
export function formatHover(result: unknown): string {
  if (result === null || result === undefined) {
    return "(no information at this position)";
  }
  if (typeof result !== "object") {
    return "(no information at this position)";
  }

  const contents = (result as { contents?: HoverContents }).contents;
  if (contents === null || contents === undefined) {
    return "(no information at this position)";
  }

  const items: MarkedString[] = Array.isArray(contents) ? contents : [contents];

  const parts = items
    .map((item) => {
      if (typeof item === "string") return item.trim();
      // { language, value } — render as fenced code block
      const { language, value } = item;
      const trimmed = value.trim();
      return language ? `\`\`\`${language}\n${trimmed}\n\`\`\`` : trimmed;
    })
    .filter((s) => s.length > 0);

  return parts.length > 0 ? parts.join("\n\n") : "(no information at this position)";
}

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

// Subset of SymbolKind values we are likely to encounter for Java.
const SYMBOL_KIND: Record<number, string> = {
  1: "File", 2: "Module", 3: "Namespace", 4: "Package",
  5: "Class", 6: "Method", 7: "Property", 8: "Field",
  9: "Constructor", 10: "Enum", 11: "Interface", 12: "Function",
  13: "Variable", 14: "Constant", 15: "String", 16: "Number",
  17: "Boolean", 18: "Array", 19: "Object", 20: "Key",
  21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
  25: "Operator", 26: "TypeParameter",
};

export interface LspSymbolInformation {
  name: string;
  kind: number;
  containerName?: string;
  location: {
    uri: string;
    range: { start: { line: number; character: number } };
  };
}

/**
 * Format a workspace/symbol result list into readable text.
 * Paths are shown relative to `cwd`; falls back to the raw URI on error.
 */
export function formatSymbols(
  symbols: LspSymbolInformation[],
  cwd: string,
  query: string,
): string {
  if (symbols.length === 0) {
    return `No symbols found matching "${query}".`;
  }

  const lines: string[] = [`Found ${symbols.length} symbol${symbols.length > 1 ? "s" : ""} matching "${query}":\n`];

  // Compute column widths for alignment.
  const rows = symbols.map((s) => {
    const kind = SYMBOL_KIND[s.kind] ?? `kind:${s.kind}`;
    const label = s.containerName ? `${s.containerName}.${s.name}` : s.name;
    const loc = formatLocation(s.location.uri, s.location.range.start.line, cwd);
    return { kind, label, loc };
  });

  const kindWidth = Math.max(...rows.map((r) => r.kind.length));
  const labelWidth = Math.max(...rows.map((r) => r.label.length));

  for (const { kind, label, loc } of rows) {
    lines.push(`  ${kind.padEnd(kindWidth)}  ${label.padEnd(labelWidth)}  ${loc}`);
  }

  return lines.join("\n");
}

function formatLocation(uri: string, line: number, cwd: string): string {
  try {
    const abs = fileURLToPath(uri);
    const rel = relative(cwd, abs);
    return `${rel}:${line + 1}`;
  } catch {
    console.warn(`[jdtls] cannot resolve URI: ${uri}`);
    return `${uri}:${line + 1}`;
  }
}
