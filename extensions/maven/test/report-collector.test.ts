import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProjectTree } from "../project-info.ts";
import { collectReportPaths } from "../report-collector.ts";

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
    const paths = collectReportPaths(singleRoot, "test", tree);
    assert.deepEqual(paths, ["target/surefire-reports"]);
  });
});

describe("collectReportPaths — single module, no reports", () => {
  it("returns an empty array when no report dir exists", () => {
    const tree = buildProjectTree(singleRoot);
    const paths = collectReportPaths(singleRoot, "test", tree);
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
    const paths = collectReportPaths(flatRoot, "test", tree);
    assert.ok(paths.includes("module-a/target/surefire-reports"), `module-a not found in: ${paths}`);
    assert.ok(paths.includes("module-b/target/surefire-reports"), `module-b not found in: ${paths}`);
  });

  it("does not include the root target dir when root has no reports", () => {
    const tree = buildProjectTree(flatRoot);
    const paths = collectReportPaths(flatRoot, "test", tree);
    assert.ok(!paths.includes("target/surefire-reports"), `root should not appear in: ${paths}`);
  });
});

describe("collectReportPaths — multi-module, only one module has reports", () => {
  const moduleAReports = join(flatRoot, "module-a/target/surefire-reports");

  before(() => mkdirSync(moduleAReports, { recursive: true }));
  after(() => rmSync(join(flatRoot, "module-a/target"), { recursive: true, force: true }));

  it("includes only the module that has a report dir", () => {
    const tree = buildProjectTree(flatRoot);
    const paths = collectReportPaths(flatRoot, "test", tree);
    assert.deepEqual(paths, ["module-a/target/surefire-reports"]);
  });
});

// ---------------------------------------------------------------------------
// collectReportPaths — failsafe reports
// ---------------------------------------------------------------------------

describe("collectReportPaths — failsafe for integration-test action", () => {
  const failsafeDir = join(flatRoot, "module-a/target/failsafe-reports");

  before(() => mkdirSync(failsafeDir, { recursive: true }));
  after(() => rmSync(join(flatRoot, "module-a/target"), { recursive: true, force: true }));

  it("looks for failsafe-reports when action is integration-test", () => {
    const tree = buildProjectTree(flatRoot);
    const paths = collectReportPaths(flatRoot, "integration-test", tree);
    assert.deepEqual(paths, ["module-a/target/failsafe-reports"]);
  });

  it("does not find surefire-reports when action is integration-test", () => {
    const tree = buildProjectTree(flatRoot);
    const paths = collectReportPaths(flatRoot, "integration-test", tree);
    assert.ok(!paths.some((p) => p.includes("surefire")), `unexpected surefire path in: ${paths}`);
  });
});
