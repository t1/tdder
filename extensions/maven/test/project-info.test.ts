import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  findProjectRoot,
  detectRunner,
  parsePom,
  buildProjectTree,
  stripInternalFields,
  resolveCurrentProject,
  availableProfiles,
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

  it("parses profile ids from the root pom only", () => {
    const pomPath = join(fixturesDir, "single-module/pom.xml");
    const pom = parsePom(pomPath);
    assert.deepEqual(pom.profiles, ["at", "rules"]);
  });
});

describe("availableProfiles", () => {
  it("returns root pom profile ids", () => {
    const root = join(fixturesDir, "single-module");
    assert.deepEqual(availableProfiles(root), ["at", "rules"]);
  });

  it("returns an empty list when the root pom defines no profiles", () => {
    const root = join(fixturesDir, "flat-multi-module");
    assert.deepEqual(availableProfiles(root), []);
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
    assert.equal(Object.keys(tree.modules!).length, 2);
    assert.equal(tree.modules!["module-a"].artifactId, "module-a");
    assert.equal(tree.modules!["module-a"].relativePath, "module-a");
    assert.equal(tree.modules!["module-b"].artifactId, "module-b");
  });

  it("builds a nested tree for a nested aggregator project", () => {
    const root = join(fixturesDir, "nested-multi-module");
    const tree = buildProjectTree(root);
    assert.equal(tree.artifactId, "root");
    assert.equal(Object.keys(tree.modules!).length, 1);
    const services = tree.modules!["services"];
    assert.equal(services.artifactId, "services");
    assert.equal(services.relativePath, "services");
    assert.equal(Object.keys(services.modules!).length, 1);
    assert.equal(services.modules!["service-a"].artifactId, "service-a");
    assert.equal(services.modules!["service-a"].relativePath, "services/service-a");
  });
});

describe("stripInternalFields", () => {
  it("removes relativePath and pomPath from a single-module project", () => {
    const root = join(fixturesDir, "single-module");
    const tree = buildProjectTree(root);
    const stripped = stripInternalFields(tree);
    assert.equal(stripped.artifactId, "single-app");
    assert.equal((stripped as Record<string, unknown>).relativePath, undefined);
    assert.equal((stripped as Record<string, unknown>).pomPath, undefined);
  });

  it("removes relativePath and pomPath from all nodes in a multi-module project", () => {
    const root = join(fixturesDir, "flat-multi-module");
    const tree = buildProjectTree(root);
    const stripped = stripInternalFields(tree);
    assert.equal((stripped as unknown as Record<string, unknown>).relativePath, undefined);
    assert.equal((stripped as unknown as Record<string, unknown>).pomPath, undefined);
    for (const child of Object.values(stripped.modules ?? {})) {
      assert.equal((child as unknown as Record<string, unknown>).relativePath, undefined);
      assert.equal((child as unknown as Record<string, unknown>).pomPath, undefined);
    }
  });

  it("preserves the nested modules structure", () => {
    const root = join(fixturesDir, "nested-multi-module");
    const tree = buildProjectTree(root);
    const stripped = stripInternalFields(tree);
    assert.ok(stripped.modules?.["services"], "services module should exist");
    assert.ok(stripped.modules?.["services"].modules?.["service-a"], "service-a should be nested under services");
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
