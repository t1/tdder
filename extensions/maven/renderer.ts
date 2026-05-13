import { Text } from "@earendil-works/pi-tui";
import type { ProjectInfoContext } from "./formatter.ts";
import { renderRunResult } from "./run-result-renderer.ts";
import type { MavenRunResult } from "./types.ts";

export type { ProjectInfoContext };

// ---------------------------------------------------------------------------
// Themed TUI rendering — produces a Text component with ANSI colours.
// Called by the maven message renderer; no LLM involvement.
// ---------------------------------------------------------------------------

type Theme = { fg: (color: string, text: string) => string; bold: (text: string) => string };

export function renderMavenMessage(
  details: Record<string, unknown>,
  theme: Theme
): Text {
  const kind = details.kind as string | undefined;

  switch (kind) {
    case "info":    return renderInfo(details, theme);
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

function renderInfo(details: Record<string, unknown>, theme: Theme): Text {
  const ctx = details.ctx as ProjectInfoContext | null;

  if (!ctx) {
    return new Text(theme.fg("warning", "Not a Maven project"), 0, 0);
  }

  const { projectRoot, runner, currentProject, projectTree } = ctx;
  const lines: string[] = [
    theme.fg("accent", theme.bold("Maven project")),
    label(theme, "root")    + theme.fg("text", projectRoot),
    label(theme, "runner")  + theme.fg("text", runner),
    label(theme, "current") + theme.fg("text", currentProject?.relativePath ?? "."),
    theme.fg("muted", "projects:"),
  ];

  renderNodeThemed(projectTree, 0, currentProject, theme, lines);

  return new Text(lines.join("\n"), 0, 0);
}

function renderNodeThemed(
  node: ProjectInfoContext["projectTree"],
  depth: number,
  current: ProjectInfoContext["currentProject"],
  theme: Theme,
  lines: string[]
): void {
  const indent = "  ".repeat(depth);
  const isCurrent = current !== null && node.relativePath === current.relativePath;
  const name = isCurrent
    ? theme.fg("success", `${node.artifactId} [current]`)
    : theme.fg("text", node.artifactId);
  lines.push(`${indent}${theme.fg("dim", "-")} ${name}`);
  for (const child of node.children) {
    renderNodeThemed(child, depth + 1, current, theme, lines);
  }
}

function renderVersion(details: Record<string, unknown>, theme: Theme): Text {
  const { groupId, artifactId, selectedVersion } = details as Record<string, string>;
  const coord = theme.fg("muted", `${groupId}:${artifactId}`);
  const arrow  = theme.fg("dim", " → ");
  const ver    = theme.fg("success", theme.bold(selectedVersion));
  return new Text(coord + arrow + ver, 0, 0);
}

function renderRun(details: Record<string, unknown>, theme: Theme): Text {
  const { success, command, rawLogPath, summary } = details as {
    success: boolean;
    command: string;
    rawLogPath: string;
    summary?: string;
  };

  const icon = success ? theme.fg("success", "✓") : theme.fg("error", "✗");
  const cmd  = theme.fg("dim", command);
  const lines = [`${icon} ${cmd}`];

  if (summary) {
    lines.push(theme.fg("error", summary));
  }

  lines.push(label(theme, "log") + theme.fg("dim", rawLogPath));

  return new Text(lines.join("\n"), 0, 0);
}

// ---------------------------------------------------------------------------
// Tool renderResult — called by the maven_run tool registration in index.ts
// ---------------------------------------------------------------------------

export function renderMavenRunResult(
  result: MavenRunResult,
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
