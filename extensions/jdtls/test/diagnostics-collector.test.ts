import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DiagnosticsCollector,
  formatDiagnostics,
  type LspDiagnostic,
} from "../diagnostics-collector.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function diag(
  severity: 1 | 2 | 3 | 4,
  message: string,
  line = 0,
  character = 0,
): LspDiagnostic {
  return {
    severity,
    message,
    range: { start: { line, character }, end: { line, character: character + 1 } },
  };
}

const FILE_URI = "file:///project/src/Foo.java";

// ---------------------------------------------------------------------------
// DiagnosticsCollector
// ---------------------------------------------------------------------------

describe("DiagnosticsCollector", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with an empty map after the quiet period if nothing was fed", async () => {
    const collector = new DiagnosticsCollector(2000);
    vi.advanceTimersByTime(2000);
    await expect(collector.promise).resolves.toEqual(new Map());
  });

  it("resolves with fed diagnostics after the quiet period", async () => {
    const collector = new DiagnosticsCollector(2000);
    const ds = [diag(1, "Syntax error")];
    collector.feed(FILE_URI, ds);
    vi.advanceTimersByTime(2000);
    const result = await collector.promise;
    expect(result.get(FILE_URI)).toEqual(ds);
  });

  it("resets the timer when a new notification arrives", async () => {
    const collector = new DiagnosticsCollector(2000);
    collector.feed(FILE_URI, [diag(1, "first")]);
    vi.advanceTimersByTime(1500); // not settled yet
    collector.feed(FILE_URI, [diag(2, "second")]); // resets timer
    vi.advanceTimersByTime(1500); // not settled (2000 ms from second feed not reached)
    // At 1500 ms after second feed, timer hasn't fired yet — promise is still pending.
    let settled = false;
    collector.promise.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(500); // now 2000 ms from second feed
    await collector.promise;
    // Latest feed wins
    const result = await collector.promise;
    expect(result.get(FILE_URI)?.[0].message).toBe("second");
  });

  it("accumulates diagnostics for different URIs", async () => {
    const collector = new DiagnosticsCollector(2000);
    collector.feed(FILE_URI, [diag(1, "error in Foo")]);
    collector.feed("", [diag(1, "JRE mismatch")]);
    vi.advanceTimersByTime(2000);
    const result = await collector.promise;
    expect(result.size).toBe(2);
    expect(result.get(FILE_URI)).toHaveLength(1);
    expect(result.get("")).toHaveLength(1);
  });

  it("settle() resolves immediately regardless of the timer", async () => {
    const collector = new DiagnosticsCollector(2000);
    collector.feed(FILE_URI, [diag(2, "warning")]);
    // Don't advance the timer — force settle.
    collector.settle();
    const result = await collector.promise;
    expect(result.get(FILE_URI)?.[0].message).toBe("warning");
  });

  it("ignores feeds after settle()", async () => {
    const collector = new DiagnosticsCollector(2000);
    collector.settle();
    collector.feed(FILE_URI, [diag(1, "late error")]); // should be ignored
    const result = await collector.promise;
    expect(result.has(FILE_URI)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatDiagnostics
// ---------------------------------------------------------------------------

describe("formatDiagnostics", () => {
  it("reports no-problems when map has no entry for the file", () => {
    const output = formatDiagnostics(FILE_URI, "src/Foo.java", new Map());
    expect(output).toBe("src/Foo.java — no problems");
  });

  it("reports no-problems when the file's diagnostic list is empty", () => {
    const map = new Map([[FILE_URI, [] as LspDiagnostic[]]]);
    const output = formatDiagnostics(FILE_URI, "src/Foo.java", map);
    expect(output).toBe("src/Foo.java — no problems");
  });

  it("lists errors and warnings with 1-based line:col", () => {
    const map = new Map([
      [FILE_URI, [diag(1, "Cannot resolve 'Foo'", 9, 4), diag(2, "Unused import", 14, 0)]],
    ]);
    const output = formatDiagnostics(FILE_URI, "src/Foo.java", map);
    expect(output).toContain("src/Foo.java — 1 error, 1 warning");
    expect(output).toContain("10:5"); // 0-based line 9 → 1-based 10
    expect(output).toContain("Cannot resolve 'Foo'");
    expect(output).toContain("15:1");
    expect(output).toContain("Unused import");
  });

  it("includes project-level diagnostics from the empty-string URI", () => {
    const map = new Map([
      [FILE_URI, [] as LspDiagnostic[]],
      ["", [diag(1, "No JRE found for this project")]],
    ]);
    const output = formatDiagnostics(FILE_URI, "src/Foo.java", map);
    expect(output).toContain("Project diagnostics");
    expect(output).toContain("No JRE found for this project");
  });

  it("omits project-level section when there are no project diagnostics", () => {
    const map = new Map([[FILE_URI, [diag(1, "error")]]]);
    const output = formatDiagnostics(FILE_URI, "src/Foo.java", map);
    expect(output).not.toContain("Project diagnostics");
  });

  it("counts correctly with multiple errors and warnings", () => {
    const map = new Map([
      [FILE_URI, [diag(1, "e1"), diag(1, "e2"), diag(2, "w1")]],
    ]);
    const output = formatDiagnostics(FILE_URI, "src/Foo.java", map);
    expect(output).toContain("2 errors, 1 warning");
  });

  it("labels severity correctly for info and hint", () => {
    const map = new Map([
      [FILE_URI, [diag(3, "Use var"), diag(4, "Consider renaming")]],
    ]);
    const output = formatDiagnostics(FILE_URI, "src/Foo.java", map);
    expect(output).toContain("info");
    expect(output).toContain("hint");
  });
});
