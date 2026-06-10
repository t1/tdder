/**
 * Maven Extension for pi
 *
 * Registers three LLM-callable tools and a /maven command:
 *   maven_project_info   – project detection and tree
 *   maven_run            – structured Maven execution
 *   maven_lookup_version – Maven Central version lookup
 */

import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

import { Container, Text } from "@earendil-works/pi-tui";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

import { renderMavenMessage, renderMavenRunResult } from "./renderer.ts";
import { buildSummary as buildCollapsedSummary } from "./run-result-renderer.ts";
import { buildMavenArgs, buildMavenCommand, type MavenAction, type TestScope } from "./maven-run.ts";
import { MavenProjectInfo, MavenRun, spawnMaven, type MavenRunOptions, type RawRunOutput } from "./maven-project.ts";
import { loadJarSkills } from "./jar-skills.ts";
import { parsePhase, formatWidgetLine } from "./progress-widget.ts";
import { buildMetadataUrl, fetchMetadata, selectVersion } from "./version-lookup.ts";
import type { MavenRunJson, VersionLookupJson } from "./tool-types.ts";
import { toMavenRunJson, toProjectInfoJson } from "./tool-types.ts";
import { filterDisplayOnlyMessages } from "./vendor/context-filter.ts";
import { INFO_LAYOUT, SUREFIRE_SKIP_NOT_CONFIGURED_MESSAGE } from "./guidance.ts";

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Shared Maven runner with live widget
// ---------------------------------------------------------------------------

/**
 * Spawn Maven with a live progress widget. The widget is cleared before
 * this function returns.  Delegates the actual spawn to `spawnMaven`;
 * this function only owns the widget lifecycle and phase tracking.
 */
async function runMaven(
  command: string,
  args: string[],
  projectRoot: string,
  ctx: ExtensionContext,
  onUpdate?: AgentToolUpdateCallback,
): Promise<RawRunOutput> {
  const WIDGET_KEY = "maven-run";
  const startTime = Date.now();
  let lineCount = 0;
  let phase = "resolving dependencies";

  const refreshWidget = (running: boolean) => {
    const line = formatWidgetLine(
      Math.floor((Date.now() - startTime) / 1000),
      lineCount,
      phase,
    );
    ctx.ui.setWidget(WIDGET_KEY, [line]);
    // Calling onUpdate triggers a pi repaint cycle that picks up the setWidget state
    if (running) onUpdate?.({ content: [{ type: "text" as const, text: `Running: ${command}` }], details: undefined });
  };

  refreshWidget(true);
  const widgetTimer = setInterval(() => refreshWidget(true), 200);

  const result = await spawnMaven(args, projectRoot, (text) => {
    for (const line of text.split("\n")) {
      lineCount++;
      const detected = parsePhase(line.trimEnd());
      if (detected !== null) phase = detected;
    }
  });

  clearInterval(widgetTimer);
  refreshWidget(false);
  ctx.ui.setWidget(WIDGET_KEY, undefined);

  return result;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

/** Shared message type for all /maven command output. */
const MAVEN_MSG_TYPE = "maven";

export default function (pi: ExtensionAPI) {

  pi.on("before_agent_start", async (event) => {
    const alreadyLoaded = event.systemPromptOptions.skills?.some(
      (s) => s.name === "maven",
    );
    if (alreadyLoaded) return;
    if (!existsSync(join(event.systemPromptOptions.cwd ?? "", "pom.xml"))) return;
    return {
      systemPrompt: event.systemPrompt + "\n\nA `pom.xml` was detected in this project. Load the `maven` skill before proceeding.",
    };
  });

  pi.on("resources_discover", async (event) => {
    const skills = await loadJarSkills(event.cwd);
    if (!skills) return {};
    return { skillPaths: [skills] };
  });


  // ── Message renderer ───────────────────────────────────────────────────────
  // All /maven command output goes through here — styled, no LLM involved.

  pi.registerMessageRenderer(MAVEN_MSG_TYPE, (message, options, theme) => {
    const border = (s: string) => theme.fg("borderMuted", s);
    const content = renderMavenMessage(message.details as Record<string, unknown>, theme, options.expanded);
    const container = new Container();
    container.addChild(new DynamicBorder(border));
    container.addChild(content);
    container.addChild(new DynamicBorder(border));
    return container;
  });

  /** Emit a styled /maven result into the chat transcript without triggering the LLM. */
  function mavenMessage(details: Record<string, unknown>): void {
    pi.sendMessage({ customType: MAVEN_MSG_TYPE, content: "", display: true, details });
  }

  // Keep display-only /maven messages out of the LLM context.
  pi.on("context", async (event) =>
    filterDisplayOnlyMessages(event, MAVEN_MSG_TYPE) as { messages?: any[] } | undefined,
  );

  // ── maven_project_info ────────────────────────────────────────────────────

  pi.registerTool({
    name: "maven_project_info",
    label: "Maven Project Info",
    description: `Returns structured information about the current Maven project: root, modules, runner, and current module. ${INFO_LAYOUT}`,
    promptSnippet: "Detect Maven project structure, runner, and module tree. The user already sees rootPath, runner, currentPath, and the project tree — do not repeat them. Print the description (if present) and a brief summary of the project.",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const cwd = resolve(ctx.cwd);
      const info = MavenProjectInfo.create(cwd);

      if (!info) {
        const result = { isMavenProject: false };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      const json = toProjectInfoJson(info);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(json, null, 2) }],
        details: json,
      };
    },

    renderResult(toolResult, { expanded }, theme) {
      const ctx = toolResult.details as Record<string, unknown> | undefined;

      if (!ctx || !ctx.isMavenProject) {
        return new Text(theme.fg("warning", "Not a Maven project"), 0, 0);
      }

      return renderMavenMessage({ kind: "info", ctx }, theme, expanded);
    },
  });

  // ── maven_run ─────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "maven_run",
    label: "Maven Run",
    description: "Runs a Maven workflow (test, package) with structured output. Prefer this over raw bash for Maven tasks.",
    promptSnippet: "Run Maven test or package with structured results",
    promptGuidelines: [
      "Use maven_run instead of bash when running Maven goals. It enforces correct flags, saves raw output to a log file, and returns a compact structured result.",
      "For action=test, testScope is required: 'surefire' (unit tests only), 'failsafe' (ITs only), or 'all' (both).",
      "maven_run examples: unit tests: maven_run(action='test', testScope='surefire'); with selector: maven_run(action='test', testScope='surefire', selector='MyTest#myMethod'); ITs only: maven_run(action='test', testScope='failsafe'); all tests: maven_run(action='test', testScope='all'); specific module: maven_run(action='test', testScope='all', project='module-a'); package: maven_run(action='package'); package module: maven_run(action='package', project='module-a'); slow test investigation: maven_run(action='test', testScope='surefire', includeTestTimings=true).",
      "If testScope='failsafe' and the tool returns SUREFIRE_SKIP_NOT_CONFIGURED, follow the instructions in the error response.",
      "If the result contains failedTestsLimit, the failedTests list is capped at that number — there may be more failures. Rerun with limit='none' to retrieve all.",
      "Each entry in failedTests has: kind (failure=assertion, error=unexpected exception), type (exception/assertion class), reportFile (path to the Surefire XML), reportFileOffset (1-based start line), and reportFileLimit (line count of the block). Read reportFile with reportFileOffset and reportFileLimit to get the full stacktrace or assertion diff — prefer this over rawMavenLogPath.",
      "When suggesting next steps that involve running Maven, tell the user to use the /maven command (e.g. '/maven test', '/maven package') rather than raw mvn commands.",
    ],
    parameters: Type.Object({
      action: StringEnum(["test", "package"] as const, {
        description: "Maven workflow to run",
      }),
      testScope: Type.Optional(StringEnum(["surefire", "failsafe", "all"] as const, {
        description: "Required when action is 'test'. 'surefire'=unit tests only, 'failsafe'=ITs only (skips Surefire), 'all'=both.",
      })),
      project: Type.Optional(Type.String({ description: "Project path or module (e.g. services/service-a)" })),
      selector: Type.Optional(Type.String({ description: "Test selector: class name or Class#method" })),
      includeTestTimings: Type.Optional(Type.Boolean({ description: "Include per-test timing data in the result. Use when investigating slow tests." })),
      limit: Type.Optional(Type.Union([Type.Number(), Type.Literal("none")], { description: "Maximum number of failed tests to include in the result. Defaults to 10. Pass 'none' for all." })),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const cwd = resolve(ctx.cwd);
      const info = MavenProjectInfo.create(cwd);
      if (!info) throw new Error("Not a Maven project");

      const { action, selector, testScope, includeTestTimings, limit: rawLimit } = params;
      const limit: number | null = rawLimit === "none" ? null : (rawLimit ?? 10);
      const project = params.project ?? info.defaultProject();

      if (action === "test" && testScope === "failsafe") {
        if (!info.surefireSkipIsConfigured) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              error: "SUREFIRE_SKIP_NOT_CONFIGURED",
              message: SUREFIRE_SKIP_NOT_CONFIGURED_MESSAGE,
            }, null, 2) }],
            details: { error: "SUREFIRE_SKIP_NOT_CONFIGURED" },
          };
        }
      }

      const opts = { action: action as MavenAction, runner: info.runner, selector, project, testScope: testScope as TestScope | undefined };
      const command = buildMavenCommand(opts);
      const args = buildMavenArgs(opts);

      onUpdate?.({ content: [{ type: "text" as const, text: `Running: ${command}` }], details: undefined });

      const runStartTime = Date.now();
      const { rawOutput, exitCode } = await runMaven(command, args, info.projectRoot, ctx, onUpdate);

      const runOpts: MavenRunOptions = { command, action, cwd, testScope: testScope as TestScope | undefined, runStartTime, includeTimings: includeTestTimings ?? false, limit };
      const run = MavenRun.fromRawOutput({ rawOutput, exitCode }, info, runOpts);
      const result = toMavenRunJson(run);

      // Keep raw output OUT of LLM-facing content — only the structured summary goes in.
      // details carries only the minimum needed for rendering: the compact result and the absolute log path.
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: { result },
      };
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined)
        ?? new Text("", 0, 0);
      const { action, project, selector, testScope } = args as { action: string; project?: string; selector?: string; testScope?: TestScope };
      const info = MavenProjectInfo.create(resolve(context.cwd));
      const runner = info?.runner ?? "mvn";
      const command = buildMavenCommand({ action: action as MavenAction, runner, project, selector, testScope });
      // After the result is available, context.state.result is set by renderResult.
      // Switch the pending icon to the final outcome icon so the command appears only once.
      const result = (context.state as { result?: MavenRunJson }).result;
      const icon = result
        ? (result.success ? theme.fg("success", "✓") : theme.fg("error", "✗"))
        : theme.fg("muted", "○");
      text.setText(`${icon} ${theme.fg("dim", command)}`);
      return text;
    },

    renderResult(toolResult, { expanded }, theme, context) {
      type RunDetails = { result: MavenRunJson };
      const details = toolResult.details as RunDetails | undefined;
      // While executing there are no details yet — return nothing (the renderCall
      // line and the progress widget already convey what is happening).
      if (!details) return new Container();
      // Share the result with renderCall so it can update its icon.
      (context.state as { result?: MavenRunJson }).result = details.result;
      if (expanded) {
        return renderMavenRunResult(details.result, true, theme, false);
      }
      // Collapsed: show only the outcome summary (command already in renderCall).
      const summary = buildCollapsedSummary(details.result, theme);
      if (!summary) return new Container();
      return new Text(summary, 0, 0);
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

      onUpdate?.({ content: [{ type: "text" as const, text: `Fetching ${metadataUrl}…` }], details: undefined });

      const { latestVersion, versions } = await fetchMetadata(groupId, artifactId, signal);
      const { selectedVersion, prereleaseFiltered } = selectVersion(latestVersion, versions, includePrereleases);

      const result: VersionLookupJson = {
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

  const SUBCOMMANDS = ["info", "test", "package", "version"] as const;
  type Subcommand = (typeof SUBCOMMANDS)[number];
  const TEST_SCOPES = ["all", "surefire", "failsafe"] as const;
  type TestScopeArg = (typeof TEST_SCOPES)[number];

  pi.registerCommand("maven", {
    description: "Maven actions: info | test [all|surefire|failsafe] [selector] | package | version <groupId>:<artifactId>",

    getArgumentCompletions: (prefix: string) => {
      const items = SUBCOMMANDS.filter((s) => s.startsWith(prefix)).map((s) => ({
        value: s,
        label: s,
        description: {
          info:    "Show project info",
          test:    "Run tests (default: all)",
          package: "Package without tests",
          version: "Look up artifact version",
        }[s],
      }));
      return items.length > 0 ? items : null;
    },

    handler: async (args, ctx) => {
      const cwd = resolve(ctx.cwd);
      const [sub, ...rest] = (args?.trim() ?? "").split(/\s+/);

      if (!sub || !SUBCOMMANDS.includes(sub as Subcommand)) {
        mavenMessage({ kind: "usage", message: `Usage: /maven ${SUBCOMMANDS.join(" | ")}` });
        return;
      }

      // version lookup — no Maven project required
      if (sub === "version") {
        const coord = rest.join(" ") || undefined;
        if (!coord || !coord.includes(":")) {
          mavenMessage({ kind: "error", message: "Usage: /maven version <groupId>:<artifactId>" });
          return;
        }
        const [groupId, artifactId] = coord.split(":");
        try {
          const { latestVersion, versions } = await fetchMetadata(groupId, artifactId);
          const { selectedVersion } = selectVersion(latestVersion, versions, false);
          mavenMessage({ kind: "version", groupId, artifactId, selectedVersion });
        } catch (err) {
          mavenMessage({ kind: "error", message: `Version lookup failed: ${(err as Error).message}` });
        }
        return;
      }

      // project info
      if (sub === "info") {
        const info = MavenProjectInfo.create(cwd);
        const infoJson = info ? toProjectInfoJson(info) : null;
        mavenMessage({ kind: "info", ctx: infoJson });
        return;
      }

      // Maven run actions
      const info = MavenProjectInfo.create(cwd);
      if (!info) {
        mavenMessage({ kind: "info", ctx: null });
        return;
      }

      let testScope: TestScope | undefined;
      let selector: string | undefined;
      if (sub === "test") {
        const [maybeScope, ...selectorParts] = rest;
        if (TEST_SCOPES.includes(maybeScope as TestScopeArg)) {
          testScope = maybeScope as TestScope;
          selector = selectorParts.join(" ") || undefined;
        } else {
          testScope = "all";
          selector = rest.join(" ") || undefined;
        }
      }
      const action: MavenAction = sub === "package" ? "package" : "test";
      const project = info.defaultProject();
      const opts = { action, runner: info.runner, selector, project, testScope };
      const command = buildMavenCommand(opts);
      const mavenArgs = buildMavenArgs(opts);

      const runStartTime = Date.now();
      const { rawOutput, exitCode } = await runMaven(command, mavenArgs, info.projectRoot, ctx);
      const runOpts: MavenRunOptions = { command, action, cwd: info.projectRoot, testScope, runStartTime };
      const run = MavenRun.fromRawOutput({ rawOutput, exitCode }, info, runOpts);
      const result = toMavenRunJson(run);
      mavenMessage({ kind: "run", result });
    },
  });
}
