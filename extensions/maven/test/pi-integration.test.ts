/**
 * Milestone 2 & 4 — in-process contract tests for the Maven pi extension.
 *
 * These tests load the extension via the pi SDK (no LLM involved) and verify:
 *   - the expected tools are registered
 *   - the /maven command is registered
 *   - maven_lookup_version returns the correct structured result (real network call)
 *   - maven_project_info works against a fixture project
 *   - maven_run produces a structured result with raw log persisted to disk
 *   - maven_run keeps raw Maven output out of LLM-facing content
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

interface WidgetCall {
  key: string;
  lines: string[] | undefined;
}

function makeRecordingCtx(cwd: string): { ctx: ExtensionContext; widgetCalls: WidgetCall[] } {
  const widgetCalls: WidgetCall[] = [];
  const ctx: ExtensionContext = {
    cwd,
    ui: {
      notify: () => {},
      setStatus: () => {},
      setWidget: (key: string, lines: string[] | undefined) => { widgetCalls.push({ key, lines }); },
      confirm: async () => false,
      select: async () => undefined,
      input: async () => undefined,
    },
  } as unknown as ExtensionContext;
  return { ctx, widgetCalls };
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
    // noExtensions suppresses package-resolved extensions (e.g. the installed tdder).
    // additionalExtensionPaths injects the local source, bundled by the SDK's esbuild.
    noExtensions: true,
    additionalExtensionPaths: [extensionPath],
  });
  await loader.reload();

  const result = await createAgentSession({
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
  });

  session = result.session;

  // additionalExtensionPaths with noExtensions means exactly one extension is loaded.
  const ext = result.extensionsResult.extensions[0];
  assert.ok(ext, `Maven extension not loaded. Errors: ${result.extensionsResult.errors.map(e => e.error).join(", ")}`);
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

  it("projectTree has no relativePath on any node", async () => {
    const tool = mavenExtension.tools.get("maven_project_info")!;
    const ctx = makeCtx(serviceACwd);
    const result = await tool.definition.execute("tc-no-relpath", {}, undefined, undefined, ctx);

    const json = JSON.parse((result.content[0] as { type: string; text: string }).text);
    assert.ok(!Array.isArray(json.projectTree), "projectTree should be an object");
    function assertNoRelativePath(node: Record<string, unknown>): void {
      assert.equal(node.relativePath, undefined, `node ${node.artifactId} should not have relativePath`);
      for (const child of Object.values((node.modules ?? {}) as Record<string, Record<string, unknown>>)) {
        assertNoRelativePath(child);
      }
    }
    assertNoRelativePath(json.projectTree as Record<string, unknown>);
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

// ---------------------------------------------------------------------------
// maven_run — LLM context safety and result shape
// ---------------------------------------------------------------------------

const singleModuleRoot = join(fixturesDir, "single-module");

describe("maven_run tool", () => {
  before(setup);

  // Run Maven once and share the result across all assertions in this suite.
  let runJson: Record<string, unknown>;
  let contentText: string;

  let resultDetails: Record<string, unknown>;

  before(async () => {
    const tool = mavenExtension.tools.get("maven_run")!;
    const ctx = makeCtx(singleModuleRoot);
    const result = await tool.definition.execute(
      "tc-run",
      { action: "package" },
      undefined,
      undefined,
      ctx,
    );
    contentText = (result.content[0] as { type: string; text: string }).text;
    runJson = JSON.parse(contentText);
    resultDetails = result.details as Record<string, unknown>;
  });

  it("returns a result containing rawMavenOut", () => {
    assert.ok(typeof runJson.rawMavenOut === "string" && (runJson.rawMavenOut as string).length > 0,
      "rawMavenOut should be a non-empty string");
  });

  it("details contains rawLogPathAbsolute for the renderer", () => {
    const abs = resultDetails.rawLogPathAbsolute as string;
    assert.ok(typeof abs === "string" && abs.startsWith("/"),
      `rawLogPathAbsolute should be an absolute path, got: ${abs}`);
    assert.ok(existsSync(abs), `rawLogPathAbsolute file should exist at ${abs}`);
  });

  it("persists the raw log file to disk", () => {
    const absLogPath = join(singleModuleRoot, runJson.rawMavenOut as string);
    assert.ok(existsSync(absLogPath), `log file should exist at ${absLogPath}`);
  });

  it("writes Maven output into the raw log file", () => {
    const absLogPath = join(singleModuleRoot, runJson.rawMavenOut as string);
    const logContent = readFileSync(absLogPath, "utf8");
    assert.ok(logContent.length > 0, "log file should be non-empty");
    assert.ok(logContent.includes("[INFO]"), "log file should contain Maven [INFO] lines");
  });

  it("does not include raw Maven output in LLM-facing content", () => {
    assert.ok(!contentText.includes("[INFO] Building"),
      "raw Maven [INFO] Building lines must not appear in LLM-facing content");
    assert.ok(!contentText.includes("[INFO] --- "),
      "raw Maven goal lines must not appear in LLM-facing content");
  });

  it("reports success true for a package run on a minimal project", () => {
    assert.equal(runJson.success, true);
  });

  it("echoes back the action in the result", () => {
    assert.equal(runJson.action, "package");
  });

  it("includes the runner and goal in the command field", () => {
    assert.ok(typeof runJson.command === "string" && (runJson.command as string).includes("package"),
      `command should contain 'package', got: ${runJson.command}`);
    assert.ok((runJson.command as string).includes("mvn"),
      `command should contain runner 'mvn', got: ${runJson.command}`);
  });

  it("includes cwd in the result", () => {
    assert.ok(typeof runJson.cwd === "string" && (runJson.cwd as string).length > 0,
      "cwd should be a non-empty string");
  });
});

// ---------------------------------------------------------------------------
// maven_run — live progress widget
// ---------------------------------------------------------------------------

describe("maven_run live progress widget", () => {
  before(setup);

  let widgetCalls: WidgetCall[];

  before(async () => {
    const tool = mavenExtension.tools.get("maven_run")!;
    const { ctx, widgetCalls: calls } = makeRecordingCtx(singleModuleRoot);
    widgetCalls = calls;
    await tool.definition.execute("tc-widget", { action: "package" }, undefined, undefined, ctx);
  });

  it("sets a widget while Maven is running", () => {
    const setCall = widgetCalls.find((c) => Array.isArray(c.lines) && c.lines.length > 0);
    assert.ok(setCall, "setWidget should have been called with a non-empty lines array");
  });

  it("widget line contains the Maven spinner prefix", () => {
    const setCall = widgetCalls.find((c) => Array.isArray(c.lines) && c.lines.length > 0)!;
    assert.ok(setCall.lines![0].includes("Maven"),
      `widget line should contain 'Maven', got: ${setCall.lines![0]}`);
  });

  it("clears the widget when Maven finishes", () => {
    const lastCall = widgetCalls.at(-1);
    assert.ok(lastCall, "setWidget should have been called at least once");
    assert.equal(lastCall!.lines, undefined,
      "last setWidget call should clear the widget (lines === undefined)");
  });
});
