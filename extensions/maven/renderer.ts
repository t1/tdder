import { Text } from "@earendil-works/pi-tui";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { nodeColumns, collectRows } from "./formatter.ts";
import type { ProjectInfoJson, Row } from "./formatter.ts";
import { renderRunResult } from "./run-result-renderer.ts";
import type { MavenRunJson } from "./tool-types.ts";

// ---------------------------------------------------------------------------
// Themed TUI rendering — produces a Text component with ANSI colours.
// Called by the maven message renderer; no LLM involvement.
// ---------------------------------------------------------------------------

type Theme = { fg: (color: any, text: string) => string; bold: (text: string) => string };

export function renderMavenMessage(
  details: Record<string, unknown>,
  theme: Theme,
  expanded = false,
): Text {
  const kind = details.kind as string | undefined;

  switch (kind) {
    case "info":    return renderInfo(details, theme, expanded);
    case "version": return renderVersion(details, theme);
    case "run":     return renderRun(details, theme);
    case "error":   return renderError(details, theme);
    case "usage":   return renderUsage(details, theme);
    default:        return new Text(String(details.message ?? ""), 0, 0);
  }
}

function label(theme: Theme, key: string): string {
  return theme.fg("muted", `${key}: `);
}

function renderInfo(details: Record<string, unknown>, theme: Theme, expanded = false): Text {
  const ctx = details.ctx as ProjectInfoJson | null;

  if (!ctx) {
    return new Text(theme.fg("warning", "Not a Maven project"), 0, 0);
  }

  const header = theme.fg("accent", theme.bold("Maven project"));

  if (expanded) {
    const lines = [
      header,
      theme.fg("dim", JSON.stringify(ctx, null, 2)),
    ];
    return new Text(lines.join("\n"), 0, 0);
  }

  const { rootPath, runner, currentPath, modules, ...rootNode } = ctx;
  const hint = theme.fg("dim", keyHint("app.tools.expand", "to expand"));
  const lines: string[] = [
    `${header}  ${hint}`,
    label(theme, "rootPath")   + theme.fg("text", rootPath),
    label(theme, "runner")     + theme.fg("text", runner),
    label(theme, "currentPath") + theme.fg("text", currentPath),
    theme.fg("muted", "projects:"),
  ];

  const root = { ...rootNode, ...(modules ? { modules } : {}) };
  const rows = collectRows(root, 0, currentPath);
  const col1Width = Math.max(...rows.map((r) => r.col1.length));
  const col2Width = Math.max(...rows.map((r) => r.col2.length));
  for (const row of rows) {
    lines.push(renderRowThemed(row, col1Width, col2Width, theme));
  }

  return new Text(lines.join("\n"), 0, 0);
}

function renderRowThemed(row: Row, col1Width: number, col2Width: number, theme: Theme): string {
  // col1 is "<indent>- <key>"; extract prefix and key to colour the key separately.
  const dashIdx = row.col1.lastIndexOf("- ");
  const prefix = row.col1.slice(0, dashIdx + 2);  // "<indent>- "
  const key    = row.col1.slice(dashIdx + 2);       // "<key>"
  const padding = " ".repeat(col1Width - row.col1.length);
  const keyColored = row.isCurrent
    ? theme.fg("success", key)
    : theme.fg("text", key);
  const col2Str = row.col2
    ? "  " + theme.fg("muted", row.col2.padEnd(col2Width))
    : "  " + " ".repeat(col2Width);
  const col3Str = row.col3 ? "  " + theme.fg("dim", row.col3) : "";
  const hasCol3 = !!row.col3;
  // Only add col2 padding if there's a col3 to align
  const col2Part = hasCol3 ? col2Str : (row.col2 ? "  " + theme.fg("muted", row.col2) : "");
  return (`${theme.fg("dim", prefix)}${keyColored}${padding}${col2Part}${col3Str}`).trimEnd();
}

function renderVersion(details: Record<string, unknown>, theme: Theme): Text {
  const { groupId, artifactId, selectedVersion } = details as Record<string, string>;
  const coord = theme.fg("muted", `${groupId}:${artifactId}`);
  const arrow  = theme.fg("dim", " → ");
  const ver    = theme.fg("success", theme.bold(selectedVersion));
  return new Text(coord + arrow + ver, 0, 0);
}

function renderRun(details: Record<string, unknown>, theme: Theme): Text {
  const { result } = details as { result: MavenRunJson };

  const icon = result.success ? theme.fg("success", "✓") : theme.fg("error", "✗");
  const lines = [
    label(theme, "command") + `${icon} ${theme.fg("dim", result.command)}`,
    ...renderRunResult(result, false, theme, false).split("\n").filter(Boolean),
    label(theme, "log") + theme.fg("dim", result.rawMavenLogPath),
  ];

  return new Text(lines.join("\n"), 0, 0);
}

// ---------------------------------------------------------------------------
// Tool renderResult — called by the maven_run tool registration in index.ts
// ---------------------------------------------------------------------------

export function renderMavenRunResult(
  result: MavenRunJson,
  expanded: boolean,
  theme: Theme,
  showCommand = true,
): Text {
  const text = renderRunResult(result, expanded, theme, showCommand);
  return new Text(text, 0, 0);
}

function renderError(details: Record<string, unknown>, theme: Theme): Text {
  return new Text(theme.fg("error", String(details.message ?? "")), 0, 0);
}

function renderUsage(details: Record<string, unknown>, theme: Theme): Text {
  return new Text(theme.fg("muted", String(details.message ?? "")), 0, 0);
}
