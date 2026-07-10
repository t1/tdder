import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderBootstrapPom } from "../bootstrap.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

  it("bootstrap tool marks successful results as requiring session recreation", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");
    assert.match(src, /requiresSessionRecreation: true/);
  });

  it("bootstrap guidelines tell the LLM to recreate the session before further tool calls", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");
    assert.match(src, /request your session to be recreated before making further tool calls/);
  });

  it("renders a minimal pom with quarkus-maven-plugin", () => {
    const pom = renderBootstrapPom({ groupId: "com.acme", artifactId: "demo" });
    assert.match(pom, /<groupId>com\.acme<\/groupId>/);
    assert.match(pom, /<artifactId>demo<\/artifactId>/);
    assert.match(pom, /<artifactId>quarkus-maven-plugin<\/artifactId>/);
    assert.match(pom, /<quarkus\.platform\.artifact-id>quarkus-bom<\/quarkus\.platform\.artifact-id>/);
  });
});
