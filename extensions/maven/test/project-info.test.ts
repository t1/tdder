import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  findProjectRoot,
  detectRunner,
  parsePom,
  buildProjectTree,
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
    assert.equal(tree.relativePath, ".");
    assert.deepEqual(tree.children, []);
  });

  it("builds a flat tree for a multi-module project", () => {
    const root = join(fixturesDir, "flat-multi-module");
    const tree = buildProjectTree(root);
    assert.equal(tree.artifactId, "root");
    assert.equal(tree.children.length, 2);
    assert.equal(tree.children[0].artifactId, "module-a");
    assert.equal(tree.children[0].relativePath, "module-a");
    assert.equal(tree.children[1].artifactId, "module-b");
  });

  it("builds a nested tree for a nested aggregator project", () => {
    const root = join(fixturesDir, "nested-multi-module");
    const tree = buildProjectTree(root);
    assert.equal(tree.artifactId, "root");
    assert.equal(tree.children.length, 1);
    const services = tree.children[0];
    assert.equal(services.artifactId, "services");
    assert.equal(services.relativePath, "services");
    assert.equal(services.children.length, 1);
    assert.equal(services.children[0].artifactId, "service-a");
    assert.equal(services.children[0].relativePath, "services/service-a");
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
