/**
 * Maven Extension for pi
 *
 * Registers three LLM-callable tools and a /maven command:
 *   maven_project_info   – project detection and tree
 *   maven_run            – structured Maven execution
 *   maven_lookup_version – Maven Central version lookup
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { Text } from "@earendil-works/pi-tui";
import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

import { findProjectRoot, detectRunner, buildProjectTree, resolveCurrentProject } from "./project-info.ts";
import { collectReportPaths, parseReports } from "./report-collector.ts";
import { renderMavenMessage, renderMavenRunResult } from "./renderer.ts";
import { formatProjectInfo } from "./formatter.ts";
import { buildMavenArgs, buildMavenCommand, type MavenAction } from "./maven-run.ts";
import { parsePhase, formatWidgetLine } from "./progress-widget.ts";
import { extractCompilationErrors, extractBuildErrors } from "./report-parser.ts";
import { saveRawLog } from "./log-store.ts";
import { buildMetadataUrl, parseMetadata, selectVersion } from "./version-lookup.ts";
import type { MavenProjectInfo, MavenRunResult, VersionLookupResult } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMavenProjectInfo(cwd: string): MavenProjectInfo | null {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) return null;

  const runner = detectRunner(projectRoot);
  const projectTree = buildProjectTree(projectRoot);
  const currentProject = resolveCurrentProject(projectTree, projectRoot, cwd);

  // Omit children from currentProject — it's a flat coordinate record in the output,
  // not a subtree. The full tree is already in projectTree.
  const currentProjectFlat = currentProject
    ? (({ children: _, ...rest }) => rest)(currentProject)
    : null;

  return {
    isMavenProject: true,
    projectRoot,
    pomPath: join(projectRoot, "pom.xml"),
    runner,
    currentProject: currentProjectFlat,
    projectTree,
  };
}

// ---------------------------------------------------------------------------
// Shared Maven runner with live widget
// ---------------------------------------------------------------------------

interface RunMavenResult {
  rawOutput: string;
  exitCode: number;
}

/**
 * Spawn Maven, stream output, and drive a live progress widget while it runs.
 * The widget is cleared before this function returns.
 */
async function runMaven(
  command: string,
  args: string[],
  projectRoot: string,
  ctx: ExtensionContext,
  onUpdate?: AgentToolUpdateCallback,
): Promise<RunMavenResult> {
  const WIDGET_KEY = "maven-run";
  const startTime = Date.now();
  let lineCount = 0;
  let phase = "resolving dependencies";

  const refreshWidget = () => {
    const line = formatWidgetLine(
      Math.floor((Date.now() - startTime) / 1000),
      lineCount,
      phase,
    );
    ctx.ui.setWidget(WIDGET_KEY, [line]);
    // Calling onUpdate triggers a pi repaint cycle that picks up the setWidget state
    onUpdate?.({ content: [{ type: "text" as const, text: `Running: ${command}` }] });
  };

  refreshWidget();
  const widgetTimer = setInterval(refreshWidget, 200);

  const rawChunks: string[] = [];
  let exitCode = 0;

  await new Promise<void>((done) => {
    const [cmd, ...spawnArgs] = args;
    const child = spawn(cmd, spawnArgs, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      rawChunks.push(text);
      for (const line of text.split("\n")) {
        lineCount++;
        const detected = parsePhase(line.trimEnd());
        if (detected !== null) phase = detected;
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      exitCode = code ?? 1;
      done();
    });
  });

  clearInterval(widgetTimer);
  ctx.ui.setWidget(WIDGET_KEY, undefined);

  return { rawOutput: rawChunks.join(""), exitCode };
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

/** Shared message type for all /maven command output. */
const MAVEN_MSG_TYPE = "maven";

export default function (pi: ExtensionAPI) {

  // ── Message renderer ───────────────────────────────────────────────────────
  // All /maven command output goes through here — styled, no LLM involved.

  pi.registerMessageRenderer(MAVEN_MSG_TYPE, (message, _options, theme) =>
    renderMavenMessage(message.details as Record<string, unknown>, theme)
  );

  /** Emit a styled /maven result into the chat transcript without triggering the LLM. */
  function mavenMessage(details: Record<string, unknown>): void {
    pi.sendMessage({ customType: MAVEN_MSG_TYPE, content: "", display: true, details });
  }

  // ── maven_project_info ────────────────────────────────────────────────────

  pi.registerTool({
    name: "maven_project_info",
    label: "Maven Project Info",
    description: "Returns structured information about the current Maven project: root, modules, runner, and current module.",
    promptSnippet: "Detect Maven project structure, runner, and module tree",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const cwd = resolve(ctx.cwd);
      const info = getMavenProjectInfo(cwd);

      if (!info) {
        const result = { isMavenProject: false };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }],
        details: info,
      };
    },
  });

  // ── maven_run ─────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "maven_run",
    label: "Maven Run",
    description: "Runs a Maven workflow (test, integration-test, verify, package) with structured output. Prefer this over raw bash for Maven tasks.",
    promptSnippet: "Run Maven test, integration-test, verify, or package with structured results",
    promptGuidelines: [
      "Use maven_run instead of bash when running Maven goals. It enforces correct flags, saves raw output to a log file, and returns a compact structured result.",
    ],
    parameters: Type.Object({
      action: StringEnum(["test", "integration-test", "verify", "package"] as const, {
        description: "Maven workflow to run",
      }),
      project: Type.Optional(Type.String({ description: "Project path or plSelector (e.g. services/service-a)" })),
      selector: Type.Optional(Type.String({ description: "Test selector: class name or Class#method" })),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const cwd = resolve(ctx.cwd);
      const info = getMavenProjectInfo(cwd);
      if (!info) throw new Error("Not a Maven project");

      const { action, selector } = params;
      const project = params.project ?? info.currentProject?.plSelector;

      const opts = { action: action as MavenAction, runner: info.runner, selector, project };
      const command = buildMavenCommand(opts);
      const args = buildMavenArgs(opts);

      onUpdate?.({ content: [{ type: "text" as const, text: `Running: ${command}` }] });

      const { rawOutput, exitCode } = await runMaven(command, args, info.projectRoot, ctx, onUpdate);

      const rawLogPath = saveRawLog(info.projectRoot, action, rawOutput);
      const success = exitCode === 0;

      const reportPaths = collectReportPaths(info.projectRoot, action, info.projectTree);
      const testSummary = parseReports(reportPaths, info.projectRoot);
      const compilationErrors = extractCompilationErrors(rawOutput);
      const buildErrors = extractBuildErrors(rawOutput);

      const result: MavenRunResult = {
        success,
        cwd,
        command,
        action,
        testSummary,
        failedTests: testSummary.failedTests,
        compilationErrors,
        buildErrors,
        reportPaths,
        rawLogPath,
      };

      // Keep raw output OUT of LLM-facing content — only the structured summary goes in.
      // details carries only the minimum needed for rendering: the compact result and the absolute log path.
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: { result, rawLogPathAbsolute: join(info.projectRoot, rawLogPath) },
      };
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent as import("@earendil-works/pi-tui").Text | undefined)
        ?? new Text("", 0, 0);
      const { action, project, selector } = args as { action: string; project?: string; selector?: string };
      const command = buildMavenCommand({ action: action as import("./maven-run.ts").MavenAction, runner: "mvn", project, selector });
      text.setText(`${theme.fg("muted", "○")} ${theme.fg("dim", command)}`);
      return text;
    },

    renderResult(toolResult, { expanded }, theme) {
      type RunDetails = { result: import("./types.ts").MavenRunResult; rawLogPathAbsolute: string };
      const details = toolResult.details as RunDetails | undefined;
      if (!details) return new Text("(no result)", 0, 0);
      // Use rawLogPathAbsolute as rawLogPath so the renderer can show the correct path.
      const result = { ...details.result, rawLogPath: details.rawLogPathAbsolute };
      return renderMavenRunResult(result, expanded ?? false, theme);
    },
  });

  // ── maven_lookup_version ──────────────────────────────────────────────────

  pi.registerTool({
    name: "maven_lookup_version",
    label: "Maven Lookup Version",
    description: "Looks up the latest authoritative version for an exact Maven coordinate from Maven Central. Use this instead of guessing versions.",
    promptSnippet: "Look up the latest version for a Maven artifact from Maven Central",
    promptGuidelines: [
      "Use maven_lookup_version before suggesting any Maven dependency version. Never guess or invent artifact versions.",
    ],
    parameters: Type.Object({
      groupId: Type.String({ description: "Maven groupId, e.g. org.assertj" }),
      artifactId: Type.String({ description: "Maven artifactId, e.g. assertj-core" }),
      includePrereleases: Type.Optional(Type.Boolean({ description: "Include RC, milestone, alpha, beta versions (default: false)" })),
    }),

    async execute(_toolCallId, params, signal, onUpdate) {
      const { groupId, artifactId, includePrereleases = false } = params;
      const metadataUrl = buildMetadataUrl(groupId, artifactId);

      onUpdate?.({ content: [{ type: "text" as const, text: `Fetching ${metadataUrl}…` }] });

      const response = await fetch(metadataUrl, { signal });
      if (!response.ok) {
        throw new Error(`Maven Central returned ${response.status} for ${metadataUrl}`);
      }
      const xml = await response.text();

      const { latestVersion, versions } = parseMetadata(xml);
      const { selectedVersion, prereleaseFiltered } = selectVersion(latestVersion, versions, includePrereleases);

      const result: VersionLookupResult = {
        groupId,
        artifactId,
        latestVersion,
        selectedVersion,
        prereleaseFiltered,
        metadataUrl,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  // ── /maven command ────────────────────────────────────────────────────────

  const SUBCOMMANDS = ["info", "test", "itest", "verify", "package", "version"] as const;
  type Subcommand = (typeof SUBCOMMANDS)[number];

  pi.registerCommand("maven", {
    description: "Maven actions: info | test [selector] | itest [selector] | verify | package | version <groupId>:<artifactId>",

    getArgumentCompletions: (prefix: string) => {
      const items = SUBCOMMANDS.filter((s) => s.startsWith(prefix)).map((s) => ({
        value: s,
        label: s,
        description: {
          info:    "Show project info",
          test:    "Run unit tests",
          itest:   "Run integration tests",
          verify:  "Run full verify",
          package: "Package without tests",
          version: "Look up artifact version",
        }[s],
      }));
      return items.length > 0 ? items : null;
    },

    handler: async (args, ctx) => {
      const cwd = resolve(ctx.cwd);
      const [sub, ...rest] = (args?.trim() ?? "").split(/\s+/);
      const selector = rest.join(" ") || undefined;

      if (!sub || !SUBCOMMANDS.includes(sub as Subcommand)) {
        mavenMessage({ kind: "usage", message: `Usage: /maven ${SUBCOMMANDS.join(" | ")}` });
        return;
      }

      // version lookup — no Maven project required
      if (sub === "version") {
        const coord = selector;
        if (!coord || !coord.includes(":")) {
          mavenMessage({ kind: "error", message: "Usage: /maven version <groupId>:<artifactId>" });
          return;
        }
        const [groupId, artifactId] = coord.split(":");
        const metadataUrl = buildMetadataUrl(groupId, artifactId);
        ctx.ui.setStatus("maven", "maven: looking up version…");
        try {
          const response = await fetch(metadataUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const xml = await response.text();
          const { latestVersion, versions } = parseMetadata(xml);
          const { selectedVersion } = selectVersion(latestVersion, versions, false);
          ctx.ui.setStatus("maven", undefined);
          mavenMessage({ kind: "version", groupId, artifactId, selectedVersion });
        } catch (err) {
          ctx.ui.setStatus("maven", undefined);
          mavenMessage({ kind: "error", message: `Version lookup failed: ${(err as Error).message}` });
        }
        return;
      }

      // project info
      if (sub === "info") {
        const info = getMavenProjectInfo(cwd);
        const ctx2 = info
          ? { projectRoot: info.projectRoot, runner: info.runner, projectTree: info.projectTree, currentProject: info.currentProject }
          : null;
        mavenMessage({ kind: "info", ctx: ctx2 });
        return;
      }

      // Maven run actions
      const info = getMavenProjectInfo(cwd);
      if (!info) {
        mavenMessage({ kind: "info", ctx: null });
        return;
      }

      const actionMap: Record<string, MavenAction> = {
        test:    "test",
        itest:   "integration-test",
        verify:  "verify",
        package: "package",
      };
      const action = actionMap[sub];
      const project = info.currentProject?.plSelector;
      const opts = { action, runner: info.runner, selector, project };
      const command = buildMavenCommand(opts);
      const mavenArgs = buildMavenArgs(opts);

      const { rawOutput, exitCode } = await runMaven(command, mavenArgs, info.projectRoot, ctx);
      const rawLogPath = saveRawLog(info.projectRoot, action, rawOutput);
      const success = exitCode === 0;

      if (success) {
        mavenMessage({ kind: "run", success: true, command, rawLogPath });
      } else {
        const compilationErrors = extractCompilationErrors(rawOutput);
        const summary = compilationErrors.length > 0
          ? `Compilation errors:\n${compilationErrors.slice(0, 5).join("\n")}`
          : `Build failed. See ${rawLogPath}`;
        mavenMessage({ kind: "run", success: false, command, rawLogPath, summary });
      }
    },
  });
}
