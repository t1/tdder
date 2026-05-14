import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  findProjectRoot,
  detectRunner,
  parsePom,
  buildProjectTree,
  flattenProjectTree,
  resolveCurrentProject,
} from "../project-info.ts";

const fixturesDir = join(import.meta.dirname, "fixtures/projects");

describe("findProjectRoot", () => {
  it("returns the directory itself for a single-module project", () => {
    const root = join(fixturesDir, "single-module");
    assert.equal(findProjectRoot(root), root);
  });

  it("returns null when no pom.xml exists in the tree", () => {
    assert.equal(findProjectRoot("/tmp"), null);
  });

  it("walks up from a child module to find the root", () => {
    const child = join(fixturesDir, "flat-multi-module/module-a");
    const expected = join(fixturesDir, "flat-multi-module");
    assert.equal(findProjectRoot(child), expected);
  });
});

describe("detectRunner", () => {
  it("returns ./mvnw when mvnw exists in the project root", () => {
    const root = join(fixturesDir, "with-wrapper");
    assert.equal(detectRunner(root), "./mvnw");
  });

  it("returns mvn when no wrapper exists", () => {
    const root = join(fixturesDir, "single-module");
    assert.equal(detectRunner(root), "mvn");
  });
});

describe("parsePom", () => {
  it("parses name when declared", () => {
    const pomPath = join(fixturesDir, "single-module/pom.xml");
    const pom = parsePom(pomPath);
    assert.equal(pom.name, "Single App");
  });

  it("returns empty string for name when not declared", () => {
    const pomPath = join(fixturesDir, "flat-multi-module/module-a/pom.xml");
    const pom = parsePom(pomPath);
    assert.equal(pom.name, "");
  });

  it("parses groupId, artifactId, version, and packaging from a pom.xml", () => {
    const pomPath = join(fixturesDir, "single-module/pom.xml");
    const pom = parsePom(pomPath);
    assert.equal(pom.groupId, "com.example");
    assert.equal(pom.artifactId, "single-app");
    assert.equal(pom.version, "1.0.0-SNAPSHOT");
    assert.equal(pom.packaging, "jar");
  });

  it("inherits groupId from parent when not explicitly declared", () => {
    const pomPath = join(fixturesDir, "flat-multi-module/module-a/pom.xml");
    const pom = parsePom(pomPath);
    assert.equal(pom.groupId, "com.acme");
  });

  it("inherits version from parent when not explicitly declared", () => {
    const pomPath = join(fixturesDir, "flat-multi-module/module-a/pom.xml");
    const pom = parsePom(pomPath);
    assert.equal(pom.version, "1.0.0-SNAPSHOT");
  });

  it("does not pick up groupId from a <dependency> block", () => {
    const pomPath = join(fixturesDir, "flat-multi-module/module-b/pom.xml");
    const pom = parsePom(pomPath);
    assert.equal(pom.groupId, "com.acme");
    assert.equal(pom.version, "1.0.0-SNAPSHOT");
  });

  it("parses module names from a multi-module pom.xml", () => {
    const pomPath = join(fixturesDir, "flat-multi-module/pom.xml");
    const pom = parsePom(pomPath);
    assert.deepEqual(pom.modules, ["module-a", "module-b"]);
  });
});

describe("buildProjectTree", () => {
  it("builds a single-node tree for a single-module project", () => {
    const root = join(fixturesDir, "single-module");
    const tree = buildProjectTree(root);
    assert.equal(tree.artifactId, "single-app");
    assert.equal(tree.name, "Single App");
    assert.equal(tree.relativePath, ".");
    assert.equal(tree.modules, undefined);
  });

  it("builds a flat tree for a multi-module project", () => {
    const root = join(fixturesDir, "flat-multi-module");
    const tree = buildProjectTree(root);
    assert.equal(tree.artifactId, "root");
    assert.equal(Object.keys(tree.modules).length, 2);
    assert.equal(tree.modules["module-a"].artifactId, "module-a");
    assert.equal(tree.modules["module-a"].relativePath, "module-a");
    assert.equal(tree.modules["module-b"].artifactId, "module-b");
  });

  it("builds a nested tree for a nested aggregator project", () => {
    const root = join(fixturesDir, "nested-multi-module");
    const tree = buildProjectTree(root);
    assert.equal(tree.artifactId, "root");
    assert.equal(Object.keys(tree.modules).length, 1);
    const services = tree.modules["services"];
    assert.equal(services.artifactId, "services");
    assert.equal(services.relativePath, "services");
    assert.equal(Object.keys(services.modules).length, 1);
    assert.equal(services.modules["service-a"].artifactId, "service-a");
    assert.equal(services.modules["service-a"].relativePath, "services/service-a");
  });
});

describe("flattenProjectTree", () => {
  it("returns a single-element array for a single-module project", () => {
    const root = join(fixturesDir, "single-module");
    const tree = buildProjectTree(root);
    const flat = flattenProjectTree(tree);
    assert.equal(flat.length, 1);
    assert.equal(flat[0].artifactId, "single-app");
    assert.equal(flat[0].relativePath, ".");
    assert.equal((flat[0] as Record<string, unknown>).modules, undefined);
  });

  it("returns all nodes in a flat array for a multi-module project", () => {
    const root = join(fixturesDir, "flat-multi-module");
    const tree = buildProjectTree(root);
    const flat = flattenProjectTree(tree);
    assert.equal(flat.length, 3);
    const artifactIds = flat.map((n) => n.artifactId);
    assert.ok(artifactIds.includes("root"));
    assert.ok(artifactIds.includes("module-a"));
    assert.ok(artifactIds.includes("module-b"));
  });

  it("flattens a nested multi-module project depth-first", () => {
    const root = join(fixturesDir, "nested-multi-module");
    const tree = buildProjectTree(root);
    const flat = flattenProjectTree(tree);
    assert.equal(flat.length, 3);
    assert.equal(flat[0].artifactId, "root");
    assert.equal(flat[1].artifactId, "services");
    assert.equal(flat[2].artifactId, "service-a");
  });

  it("omits the modules property from every node", () => {
    const root = join(fixturesDir, "flat-multi-module");
    const tree = buildProjectTree(root);
    const flat = flattenProjectTree(tree);
    for (const node of flat) {
      assert.equal((node as Record<string, unknown>).modules, undefined);
    }
  });
});

describe("resolveCurrentProject", () => {
  it("resolves to the leaf module when cwd is inside it", () => {
    const root = join(fixturesDir, "nested-multi-module");
    const cwd = join(root, "services/service-a");
    const tree = buildProjectTree(root);
    const current = resolveCurrentProject(tree, root, cwd);
    assert.equal(current?.artifactId, "service-a");
  });

  it("resolves to root when cwd is the project root", () => {
    const root = join(fixturesDir, "flat-multi-module");
    const tree = buildProjectTree(root);
    const current = resolveCurrentProject(tree, root, root);
    assert.equal(current?.artifactId, "root");
  });
});
