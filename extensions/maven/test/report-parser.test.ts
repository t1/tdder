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
    const { summary: result, failedTests } = parseSurefireReport(xml);
    assert.equal(result.testsRun, 3);
    assert.equal(result.failures, 0);
    assert.equal(result.errors, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.durationSeconds, 0.123);
    assert.deepEqual(failedTests, []);
  });

  it("returns a failing summary and populates failedTests", () => {
    const xml = readFileSync(join(reportsDir, "TEST-failing.xml"), "utf8");
    const { summary: result, failedTests } = parseSurefireReport(xml);
    assert.equal(result.testsRun, 2);
    assert.equal(result.failures, 1);
    assert.equal(failedTests.length, 1);
    assert.equal(failedTests[0].className, "com.example.BarTest");
    assert.equal(failedTests[0].methodName, "shouldFail");
    assert.equal(failedTests[0].displayName, undefined);
    assert.equal(failedTests[0].message, "expected 200 but was 503");
    assert.equal(failedTests[0].rerunSelector, "com.example.BarTest#shouldFail");
    assert.equal(failedTests[0].rerunScope, "method");
  });

  it("parses a Failsafe IT report the same way", () => {
    const xml = readFileSync(join(reportsDir, "TEST-IT-passing.xml"), "utf8");
    const { summary: result, failedTests } = parseSurefireReport(xml);
    assert.equal(result.testsRun, 1);
    assert.equal(result.failures, 0);
    assert.deepEqual(failedTests, []);
  });

  it("counts errors in the errors field but does not add them to failedTests", () => {
    const xml = readFileSync(join(reportsDir, "TEST-error.xml"), "utf8");
    const { summary: result, failedTests } = parseSurefireReport(xml);
    assert.equal(result.errors, 1);
    assert.equal(result.testsRun, 2);
    assert.deepEqual(failedTests, []);
  });

  it("returns zero counts and empty failedTests for a no-tests-run report", () => {
    const xml = readFileSync(join(reportsDir, "TEST-no-tests.xml"), "utf8");
    const { summary: result, failedTests } = parseSurefireReport(xml);
    assert.equal(result.testsRun, 0);
    assert.equal(result.failures, 0);
    assert.equal(result.errors, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.durationSeconds, 0.001);
    assert.deepEqual(failedTests, []);
  });

  it("strips ()[N] suffix from @TestFactory method names to produce a rerun selector", () => {
    const xml = projectReport("junit-java", "TEST-com.example.SampleTest$InnerContext.xml");
    const { summary: result, failedTests } = parseSurefireReport(xml);
    // dynamicTests()[2] — ()[N] stripped
    const dyn = failedTests.find((t) => t.methodName.startsWith("dynamicTests()"))!;
    assert.ok(dyn, "expected a dynamicTests failure");
    assert.equal(dyn.rerunSelector, "com.example.SampleTest#dynamicTests");
    assert.equal(dyn.rerunScope, "method");
  });

  it("parses a Cucumber passing report", () => {
    const xml = projectReport("cucumber", "TEST-com.example.RunCucumberTest.xml");
    const { summary: result, failedTests } = parseSurefireReport(xml);
    assert.equal(result.testsRun, 2);
    assert.equal(result.failures, 1); // one passing, one failing scenario
  });

  it("parses a Cucumber failing report", () => {
    const xml = projectReport("cucumber", "TEST-com.example.RunCucumberTest.xml");
    const { summary: result, failedTests } = parseSurefireReport(xml);
    assert.equal(failedTests.length, 1);
    // className is the runner class, not the feature name
    assert.equal(failedTests[0].className, "com.example.RunCucumberTest");
    // no methodName — Cucumber has no method
    assert.equal(failedTests[0].methodName, undefined);
    // displayName carries the human-readable scenario identity
    assert.equal(failedTests[0].displayName, "Sample feature - failing scenario");
    assert.equal(failedTests[0].rerunSelector, "com.example.RunCucumberTest");
    assert.equal(failedTests[0].rerunScope, "class");
    assert.ok(!failedTests[0].message.includes("&quot;"), "message should not contain &quot;");
    assert.ok(!failedTests[0].message.includes("&#10;"), "message should not contain &#10;");
    assert.ok(failedTests[0].message.includes("scenario fails"), "message should contain assertion text");
  });

  it("parses a Kotlin report with spaces in method and class names", () => {
    const xml = projectReport("junit-kotlin", "TEST-com.example.SampleTest$inner context.xml");
    const { summary: result, failedTests } = parseSurefireReport(xml);
    assert.equal(result.testsRun, 6);
    assert.equal(result.failures, 3);
    assert.equal(failedTests.length, 3);
    // spaces in method name — selector strips ()[N] suffix
    const dyn = failedTests.find((t) => t.methodName.startsWith("dynamic tests()"))!;
    assert.ok(dyn, "expected a 'dynamic tests' failure");
    assert.equal(dyn.className, "com.example.SampleTest");
    assert.equal(dyn.rerunSelector, "com.example.SampleTest#dynamic tests");
    assert.equal(dyn.rerunScope, "method");
    // plain method with spaces — preserved verbatim
    const plain = failedTests.find((t) => t.methodName === "plain fails")!;
    assert.ok(plain, "expected a 'plain fails' failure");
    assert.equal(plain.rerunSelector, "com.example.SampleTest#plain fails");
    assert.equal(plain.rerunScope, "method");
    assert.equal(plain.displayName, undefined);
    // spaces in both classname ($-nested) and method name
    const nested = failedTests.find((t) => t.methodName === "nested fails")!;
    assert.ok(nested, "expected a 'nested fails' failure");
    assert.equal(nested.className, "com.example.SampleTest$inner context");
    assert.equal(nested.rerunSelector, "com.example.SampleTest$inner context#nested fails");
    assert.equal(nested.rerunScope, "method");
    assert.equal(nested.displayName, undefined);
  });

  it("parses a Kotlin root-package report (no dots in classname)", () => {
    const xml = projectReport("junit-kotlin", "TEST-RootPackageTest.xml");
    const { summary: result, failedTests } = parseSurefireReport(xml);
    assert.equal(result.testsRun, 2);
    assert.equal(result.failures, 1);
    assert.equal(failedTests.length, 1);
    // no dots in classname — root package
    assert.equal(failedTests[0].className, "RootPackageTest");
    assert.equal(failedTests[0].methodName, "root fails");
    assert.equal(failedTests[0].displayName, undefined);
    assert.equal(failedTests[0].rerunSelector, "RootPackageTest#root fails");
    assert.equal(failedTests[0].rerunScope, "method");
  });

  it("returns zero counts for a minimal testsuite with no attributes", () => {
    const xml = "<testsuite><testcase name=\"x\" classname=\"X\"/></testsuite>";
    const { summary: result, failedTests } = parseSurefireReport(xml);
    assert.equal(result.testsRun, 0);
    assert.equal(result.failures, 0);
    assert.equal(result.errors, 0);
    assert.equal(result.skipped, 0);
    assert.deepEqual(failedTests, []);
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
    assert.ok(errors.some((e) => e.includes("forked VM terminated")));
    assert.ok(!errors.some((e) => e.includes("surefire-reports")), "should drop 'Please refer to surefire-reports'");
  });

  it("does not include blank [ERROR] lines", () => {
    const output = "[ERROR] something went wrong\n[ERROR]\n[ERROR] another error\n";
    const errors = extractBuildErrors(output);
    assert.ok(errors.every((e) => e.length > 0));
  });

  it("excludes test failure summary lines from buildErrors", () => {
    const output = [
      "[ERROR] Tests run: 2, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.037 s <<< FAILURE! -- in com.example.RunCucumberTest",
      "[ERROR] Sample feature.Sample feature - failing scenario -- Time elapsed: 0.003 s <<< FAILURE!",
      "[ERROR] Failures: ",
      "[ERROR]   scenario fails",
      "[ERROR] Tests run: 2, Failures: 1, Errors: 0, Skipped: 0",
      "[ERROR] Failed to execute goal org.apache.maven.plugins:maven-surefire-plugin:3.5.2:test (default-test) on project cucumber: There are test failures.",
      "[ERROR] See /path/to/target/surefire-reports for the individual test results.",
      "[ERROR] Please refer to target/surefire-reports for the individual test results.",
      "[ERROR] See dump files (if any exist) [date].dump, [date]-jvmRun[N].dump and [date].dumpstream.",
      "[ERROR] -> [Help 1]",
      "[ERROR] To see the full stack trace of the errors, re-run Maven with the -e switch.",
      "[ERROR] Re-run Maven using the -X switch to enable full debug logging.",
      "[ERROR] For more information about the errors and possible solutions, please read the following articles:",
      "[ERROR] [Help 1] http://cwiki.apache.org/confluence/display/MAVEN/MojoFailureException",
    ].join("\n");
    const errors = extractBuildErrors(output);
    assert.deepEqual(errors, []);
  });
});
