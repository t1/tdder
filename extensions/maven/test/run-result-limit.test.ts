import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { FailedTest } from "../report-parser.ts";

// ---------------------------------------------------------------------------
// Helper to manufacture a failedTest entry
// ---------------------------------------------------------------------------

function makeFailedTest(n: number): FailedTest {
  return {
    className: `com.example.Test${n}`,
    methodName: `test${n}`,
    message: `failure ${n}`,
    rerunSelector: `com.example.Test${n}#test${n}`,
    rerunScope: "method",
  };
}

// ---------------------------------------------------------------------------
// applyLimit — the pure helper extracted from buildRunResult
// ---------------------------------------------------------------------------

import { applyFailedTestLimit } from "../maven-project.ts";

describe("applyFailedTestLimit", () => {
  it("returns all tests unchanged when limit is null (none)", () => {
    const tests = [makeFailedTest(1), makeFailedTest(2), makeFailedTest(3)];
    const { failedTests, failedTestsLimit } = applyFailedTestLimit(tests, null);
    assert.equal(failedTests.length, 3);
    assert.equal(failedTestsLimit, undefined);
  });

  it("returns all tests unchanged when count is within limit", () => {
    const tests = [makeFailedTest(1), makeFailedTest(2)];
    const { failedTests, failedTestsLimit } = applyFailedTestLimit(tests, 10);
    assert.equal(failedTests.length, 2);
    assert.equal(failedTestsLimit, undefined);
  });

  it("sets failedTestsLimit to the limit value when count exceeds limit", () => {
    const tests = Array.from({ length: 15 }, (_, i) => makeFailedTest(i + 1));
    const { failedTests, failedTestsLimit } = applyFailedTestLimit(tests, 10);
    assert.equal(failedTests.length, 10);
    assert.equal(failedTestsLimit, 10);
  });

  it("sets failedTestsLimit to the given limit (not just 10)", () => {
    const tests = Array.from({ length: 8 }, (_, i) => makeFailedTest(i + 1));
    const { failedTests, failedTestsLimit } = applyFailedTestLimit(tests, 5);
    assert.equal(failedTests.length, 5);
    assert.equal(failedTestsLimit, 5);
  });

  it("keeps the first N tests (preserves order)", () => {
    const tests = Array.from({ length: 3 }, (_, i) => makeFailedTest(i + 1));
    const { failedTests } = applyFailedTestLimit(tests, 2);
    assert.equal(failedTests[0].className, "com.example.Test1");
    assert.equal(failedTests[1].className, "com.example.Test2");
  });
});
