import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {renderBootstrapPom} from "../bootstrap.ts";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

describe("quarkus bootstrap pom", () => {
  it("bootstrap tool resolves cwd from execute context", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");
    assert.match(src, /async execute\(_toolCallId, params, signal, onUpdate, ctx\)/);
    assert.match(src, /const projectRoot = resolve\(ctx\.cwd\);/);
  });

  it("quarkus package sync vendors the shared maven version lookup helper", () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"));
    assert.match(pkg.scripts.sync, /maven-version-lookup\.ts/);
  });

  it("bootstrap tool looks up the Quarkus BOM version via shared lookup code", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");
    assert.match(src, /fetchMetadata\("io\.quarkus\.platform", "quarkus-bom"/);
    assert.match(src, /selectVersion\(/);
  });

  it("bootstrap tool activates the Quarkus tool set on success instead of requiring session recreation", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");
    assert.match(src, /await ensureClient\(projectRoot\);/);
    assert.match(src, /const quarkusToolNames = \[\.\.\.state\.registeredToolNames]\.filter\(\(n\) => n !== "quarkus_bootstrap"\);/);
    assert.match(src, /pi\.setActiveTools\(\[\.\.\.active]\);/);
    assert.doesNotMatch(src, /requiresSessionRecreation/);
    assert.doesNotMatch(src, /autoCheckpointSessionRecreation/);
  });

  it("bootstrap tool stays generic and only declares the recreation requirement", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");
    assert.doesNotMatch(src, /task_block/);
    assert.doesNotMatch(src, /registerRequiresSessionRecreationHandler/);
  });

  it("session_start hides quarkus_bootstrap once a Quarkus pom already exists", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");
    assert.match(src, /function hideBootstrapToolWhenQuarkusIsActive/);
    assert.match(src, /pi\.getActiveTools\(\)/);
    assert.match(src, /pi\.setActiveTools\(activeTools\.filter\(\(toolName\) => toolName !== "quarkus_bootstrap"\)\)/);
    assert.match(src, /if \(!isQuarkusProject\(cwd\)\) return;[\s\S]*hideBootstrapToolWhenQuarkusIsActive\(\);/);
  });

  it("bootstrap guidelines tell the LLM the Quarkus tools become available in the current session", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");
    assert.match(src, /activates the normal Quarkus tool set in the current session before returning/);
  });

  it("renders a minimal pom with quarkus-maven-plugin", () => {
    const pom = renderBootstrapPom({groupId: "com.acme", artifactId: "demo"});
    assert.match(pom, /<groupId>com\.acme<\/groupId>/);
    assert.match(pom, /<artifactId>demo<\/artifactId>/);
    assert.match(pom, /<artifactId>quarkus-maven-plugin<\/artifactId>/);
    assert.match(pom, /<quarkus\.platform\.artifact-id>quarkus-bom<\/quarkus\.platform\.artifact-id>/);
  });
});
