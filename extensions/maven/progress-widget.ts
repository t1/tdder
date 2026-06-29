/**
 * Live progress widget for maven_run.
 *
 * Provides two pure functions consumed by the widget logic in index.ts:
 *   parsePhase(line)                      — extracts a phase label from a Maven output line
 *   formatWidgetLine(elapsed, lines, phase) — formats the one-line widget string
 */

import { formatElapsedDuration } from "./vendor/duration-format.ts";

// [INFO] Building <artifactId> [version]
const BUILDING_RE = /^\[INFO\] Building ([\w][\w.-]*)(?:\s+[\d].*)?$/;

// [INFO] --- <plugin>:<version>:<goal> (<id>) @ <artifactId> ---
const GOAL_RE = /^\[INFO\] --- [\w.-]+:[\w.-]+:([\w-]+) \([^)]+\) @ ([\w.-]+) ---$/;

/**
 * Try to extract a phase label from a single Maven output line.
 * Returns null when the line is not recognizable.
 */
export function parsePhase(line: string): string | null {
  const buildingMatch = line.match(BUILDING_RE);
  if (buildingMatch) return buildingMatch[1];

  const goalMatch = line.match(GOAL_RE);
  if (goalMatch) return `[${goalMatch[2]}] ${goalMatch[1]}`;

  return null;
}

/**
 * Format the one-line widget string.
 *
 * Example: ⚙ Maven  12s  |  847 lines  |  [service-api] test
 */
export function formatWidgetLine(elapsedSeconds: number, lineCount: number, phase: string): string {
  const lineWord = lineCount === 1 ? "line" : "lines";
  return `⚙ Maven  ${formatElapsedDuration(elapsedSeconds)}  |  ${lineCount} ${lineWord}  |  ${phase}`;
}
