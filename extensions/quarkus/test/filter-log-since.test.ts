/**
 * Unit tests for filterLogSince.
 *
 * Verifies correct timestamp parsing and line filtering behaviour.
 *
 * Note: new Date("YYYY-MM-DDTHH:MM:SS") (date-time without timezone suffix)
 * is parsed as LOCAL time by the ECMAScript spec (ES2015+). This is correct
 * for Quarkus log timestamps, which are in local time. The only UTC trap is
 * date-ONLY strings ("YYYY-MM-DD"), which filterLogSince never produces.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Copy of the function under test — kept in sync with index.ts.
// We test the pure function directly rather than importing the whole extension.
// ---------------------------------------------------------------------------

function filterLogSince(lines: string[], sinceMs: number): string[] {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Date as a Quarkus log timestamp: "YYYY-MM-DD HH:MM:SS,mmm" using local time. */
function toLogTimestamp(d: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const pad3 = (n: number) => String(n).padStart(3, "0");
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())},${pad3(d.getMilliseconds())}`
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("filterLogSince", () => {
  it("includes lines at or after the cutoff", () => {
    const now = Date.now();
    const line = `${toLogTimestamp(new Date(now))} INFO  [app] hello`;
    const result = filterLogSince([line], now);
    assert.deepEqual(result, [line], "line at cutoff time must be included");
  });

  it("excludes lines before the cutoff (beyond the 3s slack)", () => {
    const now = Date.now();
    const old = new Date(now - 10_000); // 10 seconds ago — well before cutoff
    const line = `${toLogTimestamp(old)} INFO  [app] old message`;
    const result = filterLogSince([line], now);
    assert.deepEqual(result, [], "line 10s before cutoff must be excluded");
  });

  it("includes continuation lines (no timestamp) that follow a passing line", () => {
    const now = Date.now();
    const timestamped = `${toLogTimestamp(new Date(now))} ERROR [app] boom`;
    const continuation = "    at com.example.Foo.bar(Foo.java:42)";
    const result = filterLogSince([timestamped, continuation], now);
    assert.deepEqual(result, [timestamped, continuation]);
  });

  it("excludes continuation lines that follow a filtered-out line", () => {
    const now = Date.now();
    const old = new Date(now - 10_000);
    const timestamped = `${toLogTimestamp(old)} ERROR [app] old error`;
    const continuation = "    at com.example.Foo.bar(Foo.java:42)";
    const result = filterLogSince([timestamped, continuation], now);
    assert.deepEqual(result, []);
  });

  it("round-trips correctly on non-UTC machines (date-time strings are local)", () => {
    // Construct a reference point using local-time Date components.
    // If parsing were UTC, a machine at UTC+N would shift the parsed time
    // by N hours, causing lines to fail the cutoff check incorrectly.
    const ref = new Date();
    // Round down to the nearest second to get a clean log timestamp.
    ref.setMilliseconds(0);
    const sinceMs = ref.getTime();

    // Build a log line whose timestamp matches ref in local time.
    const line = `${toLogTimestamp(ref)} INFO  [app] timezone test`;

    const result = filterLogSince([line], sinceMs);
    assert.deepEqual(
      result,
      [line],
      "date-time strings without timezone suffix are local time per ES2015 — must round-trip correctly",
    );
  });
});
