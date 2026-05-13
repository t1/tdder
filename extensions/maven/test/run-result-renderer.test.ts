import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderRunResult } from "../run-result-renderer.ts";
import type { MavenRunResult } from "../types.ts";

// ---------------------------------------------------------------------------
// Minimal theme stub — returns plain text so assertions don't need ANSI codes
// ---------------------------------------------------------------------------

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<MavenRunResult> = {}): MavenRunResult {
  return {
    success: true,
    cwd: "/repo",
    command: "mvn package -DskipTests",
    action: "package",
    testSummary: { testsRun: 0, failures: 0, errors: 0, skipped: 0, failedTests: [] },
    failedTests: [],
    compilationErrors: [],
    buildErrors: [],
    reportPaths: [],
    rawLogPath: "target/pi/maven-logs/2026-05-13T12-00-00-package.log",
    ...overrides,
  };
}

const noLog = (_path: string) => "";
const fakeLog = (_path: string) => "[INFO] BUILD SUCCESS\n[INFO] Total time: 1.234 s\n";

// ---------------------------------------------------------------------------
// Collapsed view
// ---------------------------------------------------------------------------

describe("renderRunResult — collapsed", () => {
  it("shows the success icon when build succeeded", () => {
    const text = renderRunResult(makeResult({ success: true }), false, noLog, theme);
    assert.ok(text.includes("✓"), `expected ✓ in: ${text}`);
  });

  it("shows the failure icon when build failed", () => {
    const text = renderRunResult(makeResult({ success: false }), false, noLog, theme);
    assert.ok(text.includes("✗"), `expected ✗ in: ${text}`);
  });

  it("shows the command", () => {
    const text = renderRunResult(makeResult(), false, noLog, theme);
    assert.ok(text.includes("mvn package -DskipTests"), `expected command in: ${text}`);
  });

  it("shows test counts when tests ran", () => {
    const result = makeResult({
      action: "test",
      command: "mvn test",
      testSummary: { testsRun: 5, failures: 1, errors: 0, skipped: 0, failedTests: [] },
    });
    const text = renderRunResult(result, false, noLog, theme);
    assert.ok(text.includes("5"), `expected test count in: ${text}`);
    assert.ok(text.includes("1"), `expected failure count in: ${text}`);
  });

  it("shows compilation error count when compilation errors are present", () => {
    const result = makeResult({
      success: false,
      compilationErrors: ["App.java:[10,5] ';' expected", "App.java:[11,1] illegal start of expression"],
    });
    const text = renderRunResult(result, false, noLog, theme);
    assert.ok(text.includes("2"), `expected error count in: ${text}`);
  });

  it("does not include raw log content in collapsed view", () => {
    const bigLog = (_path: string) => "[INFO] BUILD SUCCESS\n".repeat(100);
    const text = renderRunResult(makeResult(), false, bigLog, theme);
    assert.ok(!text.includes("[INFO] BUILD SUCCESS"), "collapsed view must not contain raw log lines");
  });
});

// ---------------------------------------------------------------------------
// Expanded view
// ---------------------------------------------------------------------------

describe("renderRunResult — expanded", () => {
  it("includes the raw log content when expanded", () => {
    const text = renderRunResult(makeResult(), true, fakeLog, theme);
    assert.ok(text.includes("[INFO] BUILD SUCCESS"), `expected log content in: ${text}`);
  });

  it("still shows the command when expanded", () => {
    const text = renderRunResult(makeResult(), true, fakeLog, theme);
    assert.ok(text.includes("mvn package -DskipTests"), `expected command in expanded: ${text}`);
  });
});
