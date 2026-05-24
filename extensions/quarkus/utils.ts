/**
 * Shared utilities for the Quarkus extension.
 */

import type { McpToolResult } from "./mcp-client.js";

/**
 * Extract all text blocks from an MCP tool result into a single string.
 */
export function extractText(result: McpToolResult): string {
  return result.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

/**
 * Filter log lines to only those whose timestamp is >= sinceMs.
 * Log lines are expected to start with "YYYY-MM-DD HH:MM:SS,mmm".
 * Lines without a recognisable timestamp (e.g. console prompts, continuation
 * lines) are included only if they follow a line that passed the filter.
 */
export function filterLogSince(lines: string[], sinceMs: number): string[] {
  // Allow a few seconds of slack for clock skew / log buffering
  const cutoff = sinceMs - 3_000;
  const result: string[] = [];
  let lastPassed = false;
  for (const line of lines) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})[,.]?(\d{3})?/);
    if (m) {
      const ts = new Date(m[1]!.replace(" ", "T") + (m[2] ? `.${m[2]}` : "")).getTime();
      lastPassed = !Number.isNaN(ts) && ts >= cutoff;
    }
    if (lastPassed) result.push(line);
  }
  return result;
}
