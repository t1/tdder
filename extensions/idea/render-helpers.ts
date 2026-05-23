/**
 * Helpers for collapsed-by-default / expanded-on-demand tool result rendering.
 */

/**
 * Parses text as JSON, returning the raw string on failure.
 */
export function parseSafe(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
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
