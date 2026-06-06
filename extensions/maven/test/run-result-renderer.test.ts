import { describe, it } from "vitest";
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
    testSummary: { testsRun: 0, failures: 0, errors: 0, skipped: 0, durationSeconds: 0 },
    failedTests: [],
    compilationErrors: [],
    buildErrors: [],
    rawMavenOut: "target/pi/maven-logs/2026-05-13T12-00-00-package.log",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Collapsed view
// ---------------------------------------------------------------------------

describe("renderRunResult — collapsed", () => {
  it("shows the success icon when build succeeded", () => {
    const text = renderRunResult(makeResult({ success: true }), false, theme);
    assert.ok(text.includes("✓"), `expected ✓ in: ${text}`);
  });

  it("shows the failure icon when build failed", () => {
    const text = renderRunResult(makeResult({ success: false }), false, theme);
    assert.ok(text.includes("✗"), `expected ✗ in: ${text}`);
  });

  it("shows the command", () => {
    const text = renderRunResult(makeResult(), false, theme);
    assert.ok(text.includes("mvn package -DskipTests"), `expected command in: ${text}`);
  });

  it("shows test counts when tests ran", () => {
    const result = makeResult({
      action: "test",
      command: "mvn test",
      testSummary: { testsRun: 5, failures: 1, errors: 0, skipped: 0, durationSeconds: 0 },
    });
    const text = renderRunResult(result, false, theme);
    assert.ok(text.includes("5"), `expected test count in: ${text}`);
    assert.ok(text.includes("1"), `expected failure count in: ${text}`);
  });

  it("shows duration when tests ran", () => {
    const result = makeResult({
      action: "test",
      command: "mvn test",
      testSummary: { testsRun: 3, failures: 0, errors: 0, skipped: 0, durationSeconds: 1.23 },
    });
    const text = renderRunResult(result, false, theme);
    assert.ok(text.includes("1.23s"), `expected duration in: ${text}`);
  });

  it("lists failed tests with location and message", () => {
    const result = makeResult({
      action: "test",
      command: "mvn test",
      testSummary: { testsRun: 2, failures: 1, errors: 0, skipped: 0, durationSeconds: 0 },
      failedTests: [{
        className: "com.example.FooTest",
        methodName: "shouldFail",
        message: "expected 200 but was 503",
        rerunSelector: "com.example.FooTest#shouldFail",
        rerunScope: "method",
      }],
    });
    const text = renderRunResult(result, false, theme);
    assert.ok(text.includes("com.example.FooTest#shouldFail"), `expected location in: ${text}`);
    assert.ok(text.includes("expected 200 but was 503"), `expected message in: ${text}`);
  });

  it("shows compilation error count when compilation errors are present", () => {
    const result = makeResult({
      success: false,
      compilationErrors: ["App.java:[10,5] ';' expected", "App.java:[11,1] illegal start of expression"],
    });
    const text = renderRunResult(result, false, theme);
    assert.ok(text.includes("2"), `expected error count in: ${text}`);
  });

  it("does not include JSON in collapsed view", () => {
    const text = renderRunResult(makeResult(), false, theme);
    assert.ok(!text.includes("{"), "collapsed view must not contain JSON");
  });
});

// ---------------------------------------------------------------------------
// buildSummary edge cases
// ---------------------------------------------------------------------------

describe("renderRunResult — showCommand=false", () => {
  it("omits the command line when showCommand is false", () => {
    const text = renderRunResult(makeResult(), false, theme, false);
    assert.ok(!text.includes("mvn package -DskipTests"), `command must be absent when showCommand=false: ${text}`);
  });

  it("still shows the outcome summary when showCommand is false", () => {
    const result = makeResult({
      testSummary: { testsRun: 3, failures: 0, errors: 0, skipped: 0, durationSeconds: 0 },
    });
    const text = renderRunResult(result, false, theme, false);
    assert.ok(text.includes("3"), `expected test count in: ${text}`);
  });
});

describe("buildSummary — compilation errors take priority over test counts", () => {
  it("shows compilation error count and not test counts when both are present", () => {
    const result = makeResult({
      success: false,
      compilationErrors: ["App.java:[10,5] ';' expected"],
      testSummary: { testsRun: 2, failures: 1, errors: 0, skipped: 0, durationSeconds: 0 },
    });
    const text = renderRunResult(result, false, theme);
    assert.ok(text.includes("compilation error"), `expected compilation error label in: ${text}`);
    assert.ok(!text.includes("2 tests") && !text.includes("tests,"), `test counts must not appear when compilation errors exist: ${text}`);
  });
});

describe("buildSummary — shows total on disk when it differs from tests run", () => {
  it("appends '(of N on disk)' when testSummary.totalOnDisk is set", () => {
    const result = makeResult({
      command: "mvn test",
      testSummary: { testsRun: 12, failures: 0, errors: 0, skipped: 0, durationSeconds: 0, totalOnDisk: 65 },
    });
    const text = renderRunResult(result, false, theme);
    assert.ok(text.includes("12 tests, 0 failed (of 65 on disk)"), `expected '(of 65 on disk)' in: ${text}`);
  });

  it("omits the on-disk suffix when totalOnDisk is absent", () => {
    const result = makeResult({
      command: "mvn test",
      testSummary: { testsRun: 65, failures: 0, errors: 0, skipped: 0, durationSeconds: 0 },
    });
    const text = renderRunResult(result, false, theme);
    assert.ok(text.includes("65 tests, 0 failed"), `expected plain summary in: ${text}`);
    assert.ok(!text.includes("on disk"), `unexpected 'on disk' in: ${text}`);
  });
});

describe("buildSummary — errors count as failures", () => {
  it("counts errors in the 'bad' total and marks the result as failed", () => {
    const result = makeResult({
      success: false,
      testSummary: { testsRun: 3, failures: 0, errors: 2, skipped: 0, durationSeconds: 0 },
    });
    const text = renderRunResult(result, false, theme);
    assert.ok(text.includes("2 failed"), `expected '2 failed' in: ${text}`);
  });
});

describe("buildSummary — no tests ran", () => {
  it("shows 'no tests ran' when testsRun is zero", () => {
    const result = makeResult({
      testSummary: { testsRun: 0, failures: 0, errors: 0, skipped: 0, durationSeconds: 0 },
    });
    const text = renderRunResult(result, false, theme);
    assert.ok(text.includes("no tests ran"), `expected 'no tests ran' in: ${text}`);
  });
});

// ---------------------------------------------------------------------------
// Expanded view
// ---------------------------------------------------------------------------

describe("renderRunResult — expanded", () => {
  it("shows the full JSON payload when expanded", () => {
    const text = renderRunResult(makeResult(), true, theme);
    assert.ok(text.includes('"success"'), `expected JSON key "success" in expanded view: ${text}`);
    assert.ok(text.includes('"command"'), `expected JSON key "command" in expanded view: ${text}`);
  });

  it("JSON contains the rawMavenOut", () => {
    const text = renderRunResult(makeResult(), true, theme);
    assert.ok(
      text.includes("target/pi/maven-logs/2026-05-13T12-00-00-package.log"),
      `expected rawMavenOut in expanded JSON: ${text}`,
    );
  });

  it("still shows the command header when expanded", () => {
    const text = renderRunResult(makeResult(), true, theme);
    assert.ok(text.includes("mvn package -DskipTests"), `expected command in expanded: ${text}`);
  });
});
