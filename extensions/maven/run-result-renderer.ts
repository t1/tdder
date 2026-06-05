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
  showCommand = true,
): string {
  const lines: string[] = [];

  if (showCommand) {
    const icon = result.success
      ? theme.fg("success", "✓")
      : theme.fg("error", "✗");
    const cmd = theme.fg("dim", result.command);
    lines.push(`${icon} ${cmd}`);
  }

  // Outcome summary line
  const summary = buildSummary(result, theme);
  if (summary) lines.push(summary);

  // Failed test details
  for (const t of result.failedTests) {
    const location = t.methodName ? `${t.className}#${t.methodName}` : t.className;
    lines.push(theme.fg("error", `  ✗ ${location}`));
    lines.push(`    ${t.message}`);
  }

  if (expanded) {
    lines.push("", JSON.stringify(result, null, 2));
  }

  return lines.join("\n");
}

export function buildSummary(result: MavenRunResult, theme: Theme): string {
  if ((result.compilationErrors?.length ?? 0) > 0) {
    const count = result.compilationErrors!.length;
    return theme.fg("error", `${count} compilation error${count === 1 ? "" : "s"}`);
  }

  if (result.testSummary.testsRun > 0) {
    const { testsRun, failures, errors, durationSeconds } = result.testSummary;
    const bad = failures + errors;
    const color = bad > 0 ? "error" : "success";
    const total = result.totalOnDisk?.testsRun;
    const ofTotal = total !== undefined && total !== testsRun ? ` (of ${total} on disk)` : "";
    const duration = durationSeconds > 0 ? ` · ${durationSeconds}s` : "";
    return theme.fg(color, `${testsRun} test${testsRun === 1 ? "" : "s"}, ${bad} failed${ofTotal}${duration}`);
  }

  return "";
}
