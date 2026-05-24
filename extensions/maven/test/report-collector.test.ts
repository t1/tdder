import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProjectTree } from "../project-info.ts";
import { collectReportPaths, parseReports } from "../report-collector.ts";

const fixturesDir = new URL("fixtures/projects", import.meta.url).pathname;
const flatRoot = join(fixturesDir, "flat-multi-module");
const singleRoot = join(fixturesDir, "single-module");

// ---------------------------------------------------------------------------
// collectReportPaths — single-module project
// ---------------------------------------------------------------------------

describe("collectReportPaths — single module", () => {
  const reportDir = join(singleRoot, "target/surefire-reports");

  before(() => mkdirSync(reportDir, { recursive: true }));
  after(() => rmSync(reportDir, { recursive: true, force: true }));

  it("finds the report dir at the root for a single-module project", () => {
    const tree = buildProjectTree(singleRoot);
    const paths = collectReportPaths(singleRoot, tree);
    assert.deepEqual(paths, ["target/surefire-reports"]);
  });
});

describe("collectReportPaths — single module, no reports", () => {
  it("returns an empty array when no report dir exists", () => {
    const tree = buildProjectTree(singleRoot);
    const paths = collectReportPaths(singleRoot, tree);
    assert.deepEqual(paths, []);
  });
});

// ---------------------------------------------------------------------------
// collectReportPaths — multi-module project
// ---------------------------------------------------------------------------

describe("collectReportPaths — multi-module, reports in submodules", () => {
  const moduleAReports = join(flatRoot, "module-a/target/surefire-reports");
  const moduleBReports = join(flatRoot, "module-b/target/surefire-reports");

  before(() => {
    mkdirSync(moduleAReports, { recursive: true });
    mkdirSync(moduleBReports, { recursive: true });
  });

  after(() => {
    rmSync(join(flatRoot, "module-a/target"), { recursive: true, force: true });
    rmSync(join(flatRoot, "module-b/target"), { recursive: true, force: true });
  });

  it("collects report dirs from both submodules", () => {
    const tree = buildProjectTree(flatRoot);
    const paths = collectReportPaths(flatRoot, tree);
    assert.ok(paths.includes("module-a/target/surefire-reports"), `module-a not found in: ${paths}`);
    assert.ok(paths.includes("module-b/target/surefire-reports"), `module-b not found in: ${paths}`);
  });

  it("does not include the root target dir when root has no reports", () => {
    const tree = buildProjectTree(flatRoot);
    const paths = collectReportPaths(flatRoot, tree);
    assert.ok(!paths.includes("target/surefire-reports"), `root should not appear in: ${paths}`);
  });
});

describe("collectReportPaths — multi-module, only one module has reports", () => {
  const moduleAReports = join(flatRoot, "module-a/target/surefire-reports");

  before(() => mkdirSync(moduleAReports, { recursive: true }));
  after(() => rmSync(join(flatRoot, "module-a/target"), { recursive: true, force: true }));

  it("includes only the module that has a report dir", () => {
    const tree = buildProjectTree(flatRoot);
    const paths = collectReportPaths(flatRoot, tree);
    assert.deepEqual(paths, ["module-a/target/surefire-reports"]);
  });
});

// ---------------------------------------------------------------------------
// collectReportPaths — failsafe reports
// ---------------------------------------------------------------------------

describe("collectReportPaths — both report dirs for testScope=all", () => {
  const surefireDir = join(flatRoot, "module-a/target/surefire-reports");
  const failsafeDir = join(flatRoot, "module-a/target/failsafe-reports");

  before(() => {
    mkdirSync(surefireDir, { recursive: true });
    mkdirSync(failsafeDir, { recursive: true });
  });
  after(() => rmSync(join(flatRoot, "module-a/target"), { recursive: true, force: true }));

  it("collects both surefire-reports and failsafe-reports when testScope is all", () => {
    const tree = buildProjectTree(flatRoot);
    const paths = collectReportPaths(flatRoot, tree, "all");
    assert.ok(paths.includes("module-a/target/surefire-reports"), `surefire missing in: ${paths}`);
    assert.ok(paths.includes("module-a/target/failsafe-reports"), `failsafe missing in: ${paths}`);
  });
});

describe("collectReportPaths — failsafe for testScope=failsafe", () => {
  const failsafeDir = join(flatRoot, "module-a/target/failsafe-reports");

  before(() => mkdirSync(failsafeDir, { recursive: true }));
  after(() => rmSync(join(flatRoot, "module-a/target"), { recursive: true, force: true }));

  it("looks for failsafe-reports when testScope is failsafe", () => {
    const tree = buildProjectTree(flatRoot);
    const paths = collectReportPaths(flatRoot, tree, "failsafe");
    assert.deepEqual(paths, ["module-a/target/failsafe-reports"]);
  });

  it("does not find surefire-reports when testScope is failsafe", () => {
    const tree = buildProjectTree(flatRoot);
    const paths = collectReportPaths(flatRoot, tree, "failsafe");
    assert.ok(!paths.some((p) => p.includes("surefire")), `unexpected surefire path in: ${paths}`);
  });
});

// ---------------------------------------------------------------------------
// parseReports
// ---------------------------------------------------------------------------

const reportsFixtures = join(import.meta.dirname, "fixtures/reports");

describe("parseReports — single report dir with passing tests", () => {
  const tmpDir = join(singleRoot, "target/surefire-reports-parse-passing");

  before(() => {
    mkdirSync(tmpDir, { recursive: true });
    // Copy passing and failing fixtures into the temp dir
    writeFileSync(
      join(tmpDir, "TEST-FooTest.xml"),
      readFileSync(join(reportsFixtures, "TEST-passing.xml"), "utf8")
    );
  });
  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("aggregates test counts across XML files in the directory", () => {
    const summary = parseReports(["target/surefire-reports-parse-passing"], singleRoot);
    assert.equal(summary.testsRun, 3);
    assert.equal(summary.failures, 0);
    assert.equal(summary.errors, 0);
    assert.deepEqual(summary.failedTests, []);
  });
});

describe("parseReports — single report dir with failing test", () => {
  const tmpDir = join(singleRoot, "target/surefire-reports-parse-failing");

  before(() => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "TEST-BarTest.xml"),
      readFileSync(join(reportsFixtures, "TEST-failing.xml"), "utf8")
    );
  });
  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("populates failedTests from the failing report", () => {
    const summary = parseReports(["target/surefire-reports-parse-failing"], singleRoot);
    assert.equal(summary.failures, 1);
    assert.equal(summary.failedTests.length, 1);
    assert.equal(summary.failedTests[0].methodName, "shouldFail");
  });

  it("attaches the reportFile path to each failed test", () => {
    const summary = parseReports(["target/surefire-reports-parse-failing"], singleRoot);
    assert.ok(
      summary.failedTests[0].reportFile?.includes("TEST-BarTest.xml"),
      `expected reportFile to reference TEST-BarTest.xml, got: ${summary.failedTests[0].reportFile}`
    );
  });
});

describe("parseReports — multiple report dirs are aggregated", () => {
  const dir1 = join(singleRoot, "target/surefire-reports-parse-multi-1");
  const dir2 = join(singleRoot, "target/surefire-reports-parse-multi-2");

  before(() => {
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });
    writeFileSync(join(dir1, "TEST-FooTest.xml"), readFileSync(join(reportsFixtures, "TEST-passing.xml"), "utf8"));
    writeFileSync(join(dir2, "TEST-BarTest.xml"), readFileSync(join(reportsFixtures, "TEST-failing.xml"), "utf8"));
  });
  after(() => {
    rmSync(dir1, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  });

  it("sums test counts across both dirs", () => {
    const summary = parseReports(
      ["target/surefire-reports-parse-multi-1", "target/surefire-reports-parse-multi-2"],
      singleRoot
    );
    assert.equal(summary.testsRun, 5); // 3 + 2
    assert.equal(summary.failures, 1);
  });
});

describe("parseReports — directory with no TEST-*.xml files", () => {
  const tmpDir = join(singleRoot, "target/surefire-reports-parse-empty");

  before(() => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "not-a-report.txt"), "ignored");
  });
  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("returns zero counts when no XML report files are present", () => {
    const summary = parseReports(["target/surefire-reports-parse-empty"], singleRoot);
    assert.equal(summary.testsRun, 0);
    assert.deepEqual(summary.failedTests, []);
  });
});

describe("parseReports — non-existent report dir", () => {
  it("returns zero counts without throwing when the directory does not exist", () => {
    const summary = parseReports(["target/does-not-exist-at-all"], singleRoot);
    assert.equal(summary.testsRun, 0);
    assert.deepEqual(summary.failedTests, []);
  });
});
