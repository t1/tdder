import type { MavenRunResult } from "./types.ts";

type Theme = { fg: (color: string, text: string) => string; bold: (text: string) => string };

/**
 * Renders a MavenRunResult as a plain string.
 *
 * collapsed — concise summary: icon, command, and a brief outcome line.
 * expanded  — the full JSON payload that was sent to the LLM.
 */
export function renderRunResult(
  result: MavenRunResult,
  expanded: boolean,
  theme: Theme,
): string {
  const icon = result.success
    ? theme.fg("success", "✓")
    : theme.fg("error", "✗");
  const cmd = theme.fg("dim", result.command);

  const lines: string[] = [`${icon} ${cmd}`];

  // Outcome summary line
  const summary = buildSummary(result, theme);
  if (summary) lines.push(summary);

  if (expanded) {
    lines.push("", JSON.stringify(result, null, 2));
  }

  return lines.join("\n");
}

function buildSummary(result: MavenRunResult, theme: Theme): string {
  if (result.compilationErrors.length > 0) {
    const count = result.compilationErrors.length;
    return theme.fg("error", `${count} compilation error${count === 1 ? "" : "s"}`);
  }

  if (result.testSummary.testsRun > 0) {
    const { testsRun, failures, errors } = result.testSummary;
    const bad = failures + errors;
    const color = bad > 0 ? "error" : "success";
    return theme.fg(color, `${testsRun} test${testsRun === 1 ? "" : "s"}, ${bad} failed`);
  }

  return "";
}
