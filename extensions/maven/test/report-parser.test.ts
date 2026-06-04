import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSurefireReport, extractCompilationErrors, extractBuildErrors } from "../report-parser.ts";

const reportsDir = join(import.meta.dirname, "fixtures/reports");
const consoleDir = join(import.meta.dirname, "fixtures/console-output");
const projectsDir = join(import.meta.dirname, "fixtures/projects");

function projectReport(project: string, file: string): string {
  return readFileSync(join(projectsDir, project, "expected-reports", file), "utf8");
}

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
    assert.equal(result.failedTests[0].displayName, undefined);
    assert.equal(result.failedTests[0].message, "expected 200 but was 503");
    assert.equal(result.failedTests[0].rerunSelector, "com.example.BarTest#shouldFail");
    assert.equal(result.failedTests[0].rerunScope, "method");
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

  it("strips ()[N] suffix from @TestFactory method names to produce a rerun selector", () => {
    const xml = projectReport("junit-java", "TEST-com.example.SampleTest$InnerContext.xml");
    const result = parseSurefireReport(xml);
    // dynamicTests()[2] — ()[N] stripped
    const dyn = result.failedTests.find((t) => t.methodName.startsWith("dynamicTests()"))!;
    assert.ok(dyn, "expected a dynamicTests failure");
    assert.equal(dyn.rerunSelector, "com.example.SampleTest#dynamicTests");
    assert.equal(dyn.rerunScope, "method");
  });

  it("parses a Cucumber passing report", () => {
    const xml = projectReport("cucumber", "TEST-com.example.RunCucumberTest.xml");
    const result = parseSurefireReport(xml);
    assert.equal(result.testsRun, 2);
    assert.equal(result.failures, 1); // one passing, one failing scenario
  });

  it("parses a Cucumber failing report", () => {
    const xml = projectReport("cucumber", "TEST-com.example.RunCucumberTest.xml");
    const result = parseSurefireReport(xml);
    assert.equal(result.failedTests.length, 1);
    // className is the runner class, not the feature name
    assert.equal(result.failedTests[0].className, "com.example.RunCucumberTest");
    // no methodName — Cucumber has no method
    assert.equal(result.failedTests[0].methodName, undefined);
    // displayName carries the human-readable scenario identity
    assert.equal(result.failedTests[0].displayName, "Sample feature - failing scenario");
    assert.equal(result.failedTests[0].rerunSelector, "com.example.RunCucumberTest");
    assert.equal(result.failedTests[0].rerunScope, "class");
    assert.ok(!result.failedTests[0].message.includes("&quot;"), "message should not contain &quot;");
    assert.ok(!result.failedTests[0].message.includes("&#10;"), "message should not contain &#10;");
    assert.ok(result.failedTests[0].message.includes("scenario fails"), "message should contain assertion text");
  });

  it("parses a Kotlin report with spaces in method and class names", () => {
    const xml = projectReport("junit-kotlin", "TEST-com.example.SampleTest$inner context.xml");
    const result = parseSurefireReport(xml);
    assert.equal(result.testsRun, 6);
    assert.equal(result.failures, 3);
    assert.equal(result.failedTests.length, 3);
    // spaces in method name — selector strips ()[N] suffix
    const dyn = result.failedTests.find((t) => t.methodName.startsWith("dynamic tests()"))!;
    assert.ok(dyn, "expected a 'dynamic tests' failure");
    assert.equal(dyn.className, "com.example.SampleTest");
    assert.equal(dyn.rerunSelector, "com.example.SampleTest#dynamic tests");
    assert.equal(dyn.rerunScope, "method");
    // plain method with spaces — preserved verbatim
    const plain = result.failedTests.find((t) => t.methodName === "plain fails")!;
    assert.ok(plain, "expected a 'plain fails' failure");
    assert.equal(plain.rerunSelector, "com.example.SampleTest#plain fails");
    assert.equal(plain.rerunScope, "method");
    assert.equal(plain.displayName, undefined);
    // spaces in both classname ($-nested) and method name
    const nested = result.failedTests.find((t) => t.methodName === "nested fails")!;
    assert.ok(nested, "expected a 'nested fails' failure");
    assert.equal(nested.className, "com.example.SampleTest$inner context");
    assert.equal(nested.rerunSelector, "com.example.SampleTest$inner context#nested fails");
    assert.equal(nested.rerunScope, "method");
    assert.equal(nested.displayName, undefined);
  });

  it("parses a Kotlin root-package report (no dots in classname)", () => {
    const xml = projectReport("junit-kotlin", "TEST-RootPackageTest.xml");
    const result = parseSurefireReport(xml);
    assert.equal(result.testsRun, 2);
    assert.equal(result.failures, 1);
    assert.equal(result.failedTests.length, 1);
    // no dots in classname — root package
    assert.equal(result.failedTests[0].className, "RootPackageTest");
    assert.equal(result.failedTests[0].methodName, "root fails");
    assert.equal(result.failedTests[0].displayName, undefined);
    assert.equal(result.failedTests[0].rerunSelector, "RootPackageTest#root fails");
    assert.equal(result.failedTests[0].rerunScope, "method");
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
