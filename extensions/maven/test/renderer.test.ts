import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildProjectTree } from "../project-info.ts";
import { formatProjectInfo } from "../formatter.ts";

const fixturesDir = join(import.meta.dirname, "fixtures/projects");

describe("formatProjectInfo — not a Maven project", () => {
  it("returns a terse not-found message", () => {
    const output = formatProjectInfo(null);
    assert.ok(output.includes("Not a Maven project"));
    assert.ok(output.trim().split("\n").length <= 2, "should be terse");
  });
});

describe("formatProjectInfo — single-module project", () => {
  it("shows title, root, runner, and the single project without indented tree", () => {
    const root = join(fixturesDir, "single-module");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo({ projectRoot: root, runner: "mvn", projectTree: tree, currentProject: tree });
    assert.ok(output.includes("Maven project"));
    assert.ok(output.includes(root));
    assert.ok(output.includes("mvn"));
    assert.ok(output.includes("single-app"));
    assert.ok(output.includes("[current]"));
  });

  it("includes the project name when declared", () => {
    const root = join(fixturesDir, "single-module");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo({ projectRoot: root, runner: "mvn", projectTree: tree, currentProject: tree });
    assert.ok(output.includes("Single App"));
  });

  it("formats the project entry as 'artifactId (name)' when name is declared", () => {
    const root = join(fixturesDir, "single-module");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo({ projectRoot: root, runner: "mvn", projectTree: tree, currentProject: tree });
    assert.ok(output.includes("single-app (Single App)"), `expected 'single-app (Single App)' in: ${output}`);
  });
});

describe("formatProjectInfo — flat multi-module project", () => {
  it("indents child modules under the root", () => {
    const root = join(fixturesDir, "flat-multi-module");
    const tree = buildProjectTree(root);
    const current = tree.modules["module-a"]; // module-a
    const output = formatProjectInfo({ projectRoot: root, runner: "./mvnw", projectTree: tree, currentProject: current });
    const lines = output.split("\n");
    const rootLine = lines.find((l) => /^\s*-\s*root/.test(l));
    const moduleALine = lines.find((l) => /^\s*-\s*module-a/.test(l));
    assert.ok(rootLine, "root should appear");
    assert.ok(moduleALine, "module-a should appear");
    // module-a must be indented further than root
    const rootIndent = rootLine!.match(/^(\s*)/)?.[1].length ?? 0;
    const moduleIndent = moduleALine!.match(/^(\s*)/)?.[1].length ?? 0;
    assert.ok(moduleIndent > rootIndent, "child should be indented more than root");
    assert.ok(moduleALine!.includes("[current]"));
  });
});

describe("formatProjectInfo — nested multi-module project", () => {
  it("indents the nested tree at multiple levels", () => {
    const root = join(fixturesDir, "nested-multi-module");
    const tree = buildProjectTree(root);
    const serviceA = tree.modules["services"].modules["service-a"]; // services/service-a
    const output = formatProjectInfo({ projectRoot: root, runner: "./mvnw", projectTree: tree, currentProject: serviceA });
    const lines = output.split("\n");
    const rootLine    = lines.find((l) => /^\s*-\s*root/.test(l));
    const servicesLine = lines.find((l) => /^\s*-\s*services$/.test(l.trimEnd()));
    const serviceALine = lines.find((l) => /^\s*-\s*service-a/.test(l));
    assert.ok(rootLine,     "root should appear");
    assert.ok(servicesLine, "services aggregator should appear");
    assert.ok(serviceALine, "service-a should appear");
    const indent = (l: string) => l.match(/^(\s*)/)?.[1].length ?? 0;
    assert.ok(indent(servicesLine!) > indent(rootLine!),    "services indented more than root");
    assert.ok(indent(serviceALine!) > indent(servicesLine!), "service-a indented more than services");
    assert.ok(serviceALine!.includes("[current]"));
  });
});
