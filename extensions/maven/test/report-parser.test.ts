import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSurefireReport, extractCompilationErrors, extractBuildErrors } from "../report-parser.ts";

const reportsDir = join(import.meta.dirname, "fixtures/reports");
const consoleDir = join(import.meta.dirname, "fixtures/console-output");

describe("parseSurefireReport", () => {
  it("returns a passing summary from a clean XML report", () => {
    const xml = readFileSync(join(reportsDir, "TEST-passing.xml"), "utf8");
    const result = parseSurefireReport(xml);
    assert.equal(result.testsRun, 3);
    assert.equal(result.failures, 0);
    assert.equal(result.errors, 0);
    assert.equal(result.skipped, 0);
    assert.deepEqual(result.failedTests, []);
  });

  it("returns a failing summary and populates failedTests", () => {
    const xml = readFileSync(join(reportsDir, "TEST-failing.xml"), "utf8");
    const result = parseSurefireReport(xml);
    assert.equal(result.testsRun, 2);
    assert.equal(result.failures, 1);
    assert.equal(result.failedTests.length, 1);
    assert.equal(result.failedTests[0].className, "com.example.BarTest");
    assert.equal(result.failedTests[0].methodName, "shouldFail");
    assert.equal(result.failedTests[0].message, "expected 200 but was 503");
  });

  it("parses a Failsafe IT report the same way", () => {
    const xml = readFileSync(join(reportsDir, "TEST-IT-passing.xml"), "utf8");
    const result = parseSurefireReport(xml);
    assert.equal(result.testsRun, 1);
    assert.equal(result.failures, 0);
    assert.deepEqual(result.failedTests, []);
  });

  it("counts errors in the errors field but does not add them to failedTests", () => {
    const xml = readFileSync(join(reportsDir, "TEST-error.xml"), "utf8");
    const result = parseSurefireReport(xml);
    assert.equal(result.errors, 1);
    assert.equal(result.testsRun, 2);
    assert.deepEqual(result.failedTests, []);
  });

  it("returns zero counts and empty failedTests for a no-tests-run report", () => {
    const xml = readFileSync(join(reportsDir, "TEST-no-tests.xml"), "utf8");
    const result = parseSurefireReport(xml);
    assert.equal(result.testsRun, 0);
    assert.equal(result.failures, 0);
    assert.equal(result.errors, 0);
    assert.equal(result.skipped, 0);
    assert.deepEqual(result.failedTests, []);
  });

  it("returns zero counts for a minimal testsuite with no attributes", () => {
    const xml = "<testsuite><testcase name=\"x\" classname=\"X\"/></testsuite>";
    const result = parseSurefireReport(xml);
    assert.equal(result.testsRun, 0);
    assert.equal(result.failures, 0);
    assert.equal(result.errors, 0);
    assert.equal(result.skipped, 0);
    assert.deepEqual(result.failedTests, []);
  });
});

describe("extractCompilationErrors", () => {
  it("extracts [ERROR] lines that reference a file and line number", () => {
    const output = readFileSync(join(consoleDir, "compilation-failure.txt"), "utf8");
    const errors = extractCompilationErrors(output);
    assert.equal(errors.length, 2);
    assert.ok(errors[0].includes("App.java"));
    assert.ok(errors[0].includes("';' expected"));
  });
});

describe("extractBuildErrors", () => {
  it("extracts non-compilation [ERROR] lines from build/setup failures", () => {
    const output = readFileSync(join(consoleDir, "build-setup-failure.txt"), "utf8");
    const errors = extractBuildErrors(output);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.includes("Non-resolvable parent POM")));
  });

  it("extracts the resolution error from a dependency-resolution-failure log", () => {
    const output = readFileSync(join(consoleDir, "dependency-resolution-failure.txt"), "utf8");
    const errors = extractBuildErrors(output);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.includes("Could not resolve dependencies")));
  });

  it("extracts the forked-VM error from a test-failure-incomplete-report log", () => {
    const output = readFileSync(join(consoleDir, "test-failure-incomplete-report.txt"), "utf8");
    const errors = extractBuildErrors(output);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.includes("forked VM terminated")));
  });

  it("does not include blank [ERROR] lines", () => {
    const output = "[ERROR] something went wrong\n[ERROR]\n[ERROR] another error\n";
    const errors = extractBuildErrors(output);
    assert.ok(errors.every((e) => e.length > 0));
  });
});
