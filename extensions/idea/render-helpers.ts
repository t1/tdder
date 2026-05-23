/**
 * Helpers for collapsed-by-default / expanded-on-demand tool result rendering.
 */

/**
 * Returns a one-line summary of the MCP result text.
 * - JSON array → "N result(s)"
 * - Anything else → first line of the text
 */
export function summarizeContent(text: string): string {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const n = parsed.length;
      return `${n} ${n === 1 ? "result" : "results"}`;
    }
  } catch {
    // fall through
  }
  return text.split("\n")[0] ?? text;
}

/**
 * Returns the text pretty-printed if it is valid JSON, or unchanged otherwise.
 */
export function prettyPrintContent(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
