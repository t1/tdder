/**
 * Milestone 2 — in-process contract tests for the Maven pi extension.
 *
 * These tests load the extension via the pi SDK (no LLM involved) and verify:
 *   - the expected tools are registered
 *   - the /maven command is registered
 *   - maven_lookup_version returns the correct structured result (real network call)
 *   - maven_project_info works against a fixture project
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession, Extension } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Minimal ExtensionContext stub — only what execute() needs for these tests
// ---------------------------------------------------------------------------

function makeCtx(cwd: string): ExtensionContext {
  return {
    cwd,
    ui: {
      notify: () => {},
      setStatus: () => {},
      setWidget: () => {},
      confirm: async () => false,
      select: async () => undefined,
      input: async () => undefined,
    },
  } as unknown as ExtensionContext;
}

// ---------------------------------------------------------------------------
// Shared state loaded once
// ---------------------------------------------------------------------------

const extensionPath = resolve(import.meta.dirname, "../index.ts");
const fixturesDir = resolve(import.meta.dirname, "fixtures/projects");
const nestedRoot = join(fixturesDir, "nested-multi-module");
const serviceACwd = join(nestedRoot, "services/service-a");

let mavenExtension: Extension;
let session: AgentSession;

async function setup() {
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    additionalExtensionPaths: [extensionPath],
  });
  await loader.reload();

  const result = await createAgentSession({
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
  });

  session = result.session;

  // extensionsResult.runtime is a stub (action dispatchers only) — it does NOT expose
  // registered tools or commands. Those live on extensions[N].tools / .commands.
  // We find the maven extension by resolvedPath to avoid depending on load order.
  const ext = result.extensionsResult.extensions.find((e) =>
    e.resolvedPath.endsWith("maven/index.ts") || e.resolvedPath.endsWith("maven/index.js")
  );
  assert.ok(ext, `Maven extension not found in loaded extensions: ${result.extensionsResult.extensions.map(e => e.resolvedPath).join(", ")}`);
  mavenExtension = ext;
}

// ---------------------------------------------------------------------------
// Extension loading
// ---------------------------------------------------------------------------

describe("extension loading", () => {
  before(setup);

  it("loads the maven extension without errors", () => {
    assert.ok(mavenExtension, "maven extension should be loaded");
  });

  it("registers the maven_project_info tool", () => {
    assert.ok(mavenExtension.tools.has("maven_project_info"), "maven_project_info not registered");
  });

  it("registers the maven_run tool", () => {
    assert.ok(mavenExtension.tools.has("maven_run"), "maven_run not registered");
  });

  it("registers the maven_lookup_version tool", () => {
    assert.ok(mavenExtension.tools.has("maven_lookup_version"), "maven_lookup_version not registered");
  });

  it("registers the /maven command", () => {
    assert.ok(mavenExtension.commands.has("maven"), "/maven command not registered");
  });
});

// ---------------------------------------------------------------------------
// maven_project_info — fixture project
// ---------------------------------------------------------------------------

describe("maven_project_info tool", () => {
  before(setup);

  it("returns isMavenProject true for the nested fixture project", async () => {
    const tool = mavenExtension.tools.get("maven_project_info")!;
    const ctx = makeCtx(serviceACwd);
    const result = await tool.definition.execute("tc-1", {}, undefined, undefined, ctx);

    const json = JSON.parse((result.content[0] as { type: string; text: string }).text);
    assert.equal(json.isMavenProject, true);
  });

  it("resolves currentProject to service-a when cwd is inside it", async () => {
    const tool = mavenExtension.tools.get("maven_project_info")!;
    const ctx = makeCtx(serviceACwd);
    const result = await tool.definition.execute("tc-2", {}, undefined, undefined, ctx);

    const json = JSON.parse((result.content[0] as { type: string; text: string }).text);
    assert.equal(json.currentProject?.artifactId, "service-a");
  });

  it("returns isMavenProject false for a non-Maven directory", async () => {
    const tool = mavenExtension.tools.get("maven_project_info")!;
    const ctx = makeCtx("/tmp");
    const result = await tool.definition.execute("tc-3", {}, undefined, undefined, ctx);

    const json = JSON.parse((result.content[0] as { type: string; text: string }).text);
    assert.equal(json.isMavenProject, false);
  });
});

// ---------------------------------------------------------------------------
// maven_lookup_version — real Maven Central network call
// ---------------------------------------------------------------------------

describe("maven_lookup_version tool", () => {
  before(setup);

  it("returns a structured result with groupId and artifactId echoed back", async () => {
    const tool = mavenExtension.tools.get("maven_lookup_version")!;
    const ctx = makeCtx(process.cwd());
    const result = await tool.definition.execute(
      "tc-4",
      { groupId: "org.assertj", artifactId: "assertj-core", includePrereleases: false },
      undefined,
      undefined,
      ctx,
    );

    const json = JSON.parse((result.content[0] as { type: string; text: string }).text);
    assert.equal(json.groupId, "org.assertj");
    assert.equal(json.artifactId, "assertj-core");
    assert.ok(typeof json.selectedVersion === "string" && json.selectedVersion.length > 0,
      "selectedVersion should be a non-empty string");
    assert.ok(typeof json.metadataUrl === "string" && json.metadataUrl.includes("assertj-core"),
      "metadataUrl should reference the artifact");
  });

  it("selectedVersion is not a prerelease when includePrereleases is false", async () => {
    const tool = mavenExtension.tools.get("maven_lookup_version")!;
    const ctx = makeCtx(process.cwd());
    const result = await tool.definition.execute(
      "tc-5",
      { groupId: "org.assertj", artifactId: "assertj-core", includePrereleases: false },
      undefined,
      undefined,
      ctx,
    );

    const json = JSON.parse((result.content[0] as { type: string; text: string }).text);
    const v: string = json.selectedVersion;
    const prereleasePattern = /[-.]?(SNAPSHOT|alpha|beta|RC\d*|M\d*|milestone)/i;
    assert.ok(!prereleasePattern.test(v), `selectedVersion "${v}" looks like a prerelease`);
  });
});
