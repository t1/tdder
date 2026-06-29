import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildProjectTree, stripInternalFields } from "../project-info.ts";
import type { ProjectNode } from "../project-info.ts";
import { formatProjectInfo } from "../formatter.ts";
import type { ProjectInfoJson } from "../formatter.ts";

function toJson(root: string, runner: string, tree: ProjectNode, current: ProjectNode | null, profiles: string[] = []): ProjectInfoJson {
  const { modules, ...rootFields } = stripInternalFields(tree);
  return {
    isMavenProject: true,
    rootPath: root,
    runner,
    currentPath: current?.relativePath ?? ".",
    profiles,
    ...rootFields,
    ...(modules ? { modules } : {}),
  };
}

const fixturesDir = join(import.meta.dirname, "fixtures/projects");

// ---------------------------------------------------------------------------
// formatProjectLabel — the per-node label logic
// ---------------------------------------------------------------------------
// These tests work by building a real tree from fixture POMs and checking the
// exact text that appears on the relevant project line.

function projectLine(output: string, moduleKey: string): string {
  // Match a line whose first non-whitespace token after "- " is the module key
  const line = output.split("\n").find((l) => new RegExp(`^\\s*-\\s*${moduleKey}(\\s|$)`).test(l));
  if (!line) throw new Error(`No line found for module key '${moduleKey}' in:\n${output}`);
  return line.trim();
}

describe("formatProjectLabel — root node (no parent)", () => {
  it("shows groupId for the root because there is no parent to inherit from", () => {
    const root = join(fixturesDir, "flat-multi-module");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo(toJson(root, "mvn", tree, null));
    const line = projectLine(output, "root");
    assert.ok(line.includes("com.acme"), `expected groupId in root line: ${line}`);
  });

  it("always shows packaging for the root", () => {
    const root = join(fixturesDir, "flat-multi-module");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo(toJson(root, "mvn", tree, null));
    const line = projectLine(output, "root");
    assert.ok(line.includes("pom"), `expected packaging in root line: ${line}`);
  });
});

describe("formatProjectLabel — child with same groupId and matching artifactId", () => {
  it("omits groupId when same as parent", () => {
    const root = join(fixturesDir, "flat-multi-module");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo(toJson(root, "mvn", tree, null));
    const line = projectLine(output, "module-a");
    assert.ok(!line.includes("com.acme"), `groupId must be absent when same as parent: ${line}`);
  });

  it("omits artifactId annotation when artifactId matches the module key", () => {
    const root = join(fixturesDir, "flat-multi-module");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo(toJson(root, "mvn", tree, null));
    const line = projectLine(output, "module-a");
    // "module-a" appears as the key; a second occurrence would indicate an explicit artifactId badge
    const occurrences = (line.match(/module-a/g) ?? []).length;
    assert.equal(occurrences, 1, `artifactId must not be repeated when equal to module key: ${line}`);
  });

  it("omits version when same as parent", () => {
    const root = join(fixturesDir, "flat-multi-module");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo(toJson(root, "mvn", tree, null));
    const line = projectLine(output, "module-a");
    assert.ok(!line.includes("1.0.0-SNAPSHOT"), `version must be absent when same as parent: ${line}`);
  });

  it("always shows packaging", () => {
    const root = join(fixturesDir, "flat-multi-module");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo(toJson(root, "mvn", tree, null));
    const line = projectLine(output, "module-a");
    assert.ok(line.includes("jar"), `expected packaging in line: ${line}`);
  });
});

describe("formatProjectLabel — child with custom artifactId", () => {
  it("shows the artifactId when it differs from the module key", () => {
    const root = join(fixturesDir, "label-cases");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo(toJson(root, "mvn", tree, null));
    const line = projectLine(output, "custom-artifactid");
    assert.ok(line.includes("my-special-artifact"), `expected artifactId badge in line: ${line}`);
  });
});

describe("formatProjectLabel — child with different groupId", () => {
  it("shows the groupId when it differs from parent's groupId", () => {
    const root = join(fixturesDir, "label-cases");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo(toJson(root, "mvn", tree, null));
    const line = projectLine(output, "different-group");
    assert.ok(line.includes("org.other"), `expected groupId badge in line: ${line}`);
  });
});

describe("formatProjectLabel — child with different version", () => {
  it("shows the version when it differs from parent's version", () => {
    const root = join(fixturesDir, "label-cases");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo(toJson(root, "mvn", tree, null));
    const line = projectLine(output, "different-version");
    assert.ok(line.includes("2.0.0"), `expected version badge in line: ${line}`);
  });

  it("does not show the version when same as parent", () => {
    const root = join(fixturesDir, "label-cases");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo(toJson(root, "mvn", tree, null));
    const line = projectLine(output, "custom-artifactid");
    assert.ok(!line.includes("1.0.0-SNAPSHOT"), `version must be absent when same as parent: ${line}`);
  });
});

describe("formatProjectLabel — name", () => {
  it("appends the name at the end of the line", () => {
    const root = join(fixturesDir, "single-module");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo(toJson(root, "mvn", tree, null));
    const line = projectLine(output, "single-app");
    assert.ok(line.endsWith("Single App") || line.includes("Single App"), `expected name at end of line: ${line}`);
  });
});

// ---------------------------------------------------------------------------

describe("formatProjectInfo — not a Maven project", () => {
  it("returns a terse not-found message", () => {
    const output = formatProjectInfo(null);
    assert.ok(output.includes("Not a Maven project"));
    assert.ok(output.trim().split("\n").length <= 2, "should be terse");
  });
});

describe("formatProjectInfo — single-module project", () => {
  it("shows title, root, runner, profiles, and the single project without indented tree", () => {
    const root = join(fixturesDir, "single-module");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo(toJson(root, "mvn", tree, tree, ["at", "rules"]));
    assert.ok(output.includes("Maven project"));
    assert.ok(output.includes(root));
    assert.ok(output.includes("mvn"));
    assert.ok(output.includes("profiles:    at, rules"));
    assert.ok(output.includes("single-app"));
  });

  it("includes the project name when declared", () => {
    const root = join(fixturesDir, "single-module");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo(toJson(root, "mvn", tree, tree));
    assert.ok(output.includes("Single App"));
  });

  it("formats the project entry with name at the end", () => {
    const root = join(fixturesDir, "single-module");
    const tree = buildProjectTree(root);
    const output = formatProjectInfo(toJson(root, "mvn", tree, tree));
    assert.ok(output.includes("Single App"), `expected name 'Single App' in: ${output}`);
    const lines = output.split("\n");
    const projectLine = lines.find((l) => l.includes("single-app"))!;
    assert.ok(projectLine.includes("Single App"), `name should appear in line: ${projectLine}`);
    // name is in the third column; the line should contain it
    assert.ok(projectLine.includes("Single App"), `name must appear in line: ${projectLine}`);
  });
});

describe("formatProjectInfo — flat multi-module project", () => {
  it("indents child modules under the root", () => {
    const root = join(fixturesDir, "flat-multi-module");
    const tree = buildProjectTree(root);
    const current = tree.modules!["module-a"]; // module-a
    const output = formatProjectInfo(toJson(root, "./mvnw", tree, current));
    const lines = output.split("\n");
    const rootLine = lines.find((l) => /^\s*-\s*root/.test(l));
    const moduleALine = lines.find((l) => /^\s*-\s*module-a/.test(l));
    assert.ok(rootLine, "root should appear");
    assert.ok(moduleALine, "module-a should appear");
    // module-a must be indented further than root
    const rootIndent = rootLine!.match(/^(\s*)/)?.[1].length ?? 0;
    const moduleIndent = moduleALine!.match(/^(\s*)/)?.[1].length ?? 0;
    assert.ok(moduleIndent > rootIndent, "child should be indented more than root");
    // current is conveyed by colour only, not a text marker
  });
});

describe("formatProjectInfo — nested multi-module project", () => {
  it("indents the nested tree at multiple levels", () => {
    const root = join(fixturesDir, "nested-multi-module");
    const tree = buildProjectTree(root);
    const serviceA = tree.modules!["services"].modules!["service-a"]; // services/service-a
    const output = formatProjectInfo(toJson(root, "./mvnw", tree, serviceA));
    const lines = output.split("\n");
    const rootLine    = lines.find((l) => /^\s*-\s*root/.test(l));
    const servicesLine = lines.find((l) => /^\s*-\s*services(\s|$)/.test(l.trimEnd()));
    const serviceALine = lines.find((l) => /^\s*-\s*service-a/.test(l));
    assert.ok(rootLine,     "root should appear");
    assert.ok(servicesLine, "services aggregator should appear");
    assert.ok(serviceALine, "service-a should appear");
    const indent = (l: string) => l.match(/^(\s*)/)?.[1].length ?? 0;
    assert.ok(indent(servicesLine!) > indent(rootLine!),    "services indented more than root");
    assert.ok(indent(serviceALine!) > indent(servicesLine!), "service-a indented more than services");
    // current is conveyed by colour only, not a text marker
  });
});
