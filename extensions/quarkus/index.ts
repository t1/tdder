/**
 * Quarkus MCP Extension for pi
 *
 * Spawns the quarkus-agent-mcp stdio server (via jbang) and proxies all of its
 * MCP tools as native pi tools so the LLM can use quarkus_start, quarkus_stop,
 * quarkus_callTool, quarkus_skills, quarkus_searchDocs, etc. without leaving pi.
 *
 * The server is started lazily — only when the current project looks like a
 * Quarkus project (contains a pom.xml or build.gradle that references "quarkus").
 * It is restarted automatically if it crashes.
 *
 * Placement: extensions/quarkus/index.ts  (part of the t1/tdder pi package)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateTail,
  keyHint,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { McpClient, type McpTool } from "./mcp-client.js";
import { extractText, filterLogSince } from "./utils.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** The jbang alias that launches the quarkus-agent-mcp stdio server. */
const JBANG_ALIAS = "quarkus-agent-mcp@quarkusio";

/** How long (ms) to wait for the MCP server to initialise before giving up. */
const STARTUP_TIMEOUT_MS = 60_000;

/** Number of result/log lines shown in the collapsed message preview. */
const PREVIEW_LINES = 10;

// ---------------------------------------------------------------------------
// Quarkus project detection
// ---------------------------------------------------------------------------

/** Returns true if the given directory looks like a Quarkus project. */
function isQuarkusProject(dir: string): boolean {
  const candidates = [
    { file: "pom.xml", pattern: "quarkus" },
    { file: "build.gradle", pattern: "quarkus" },
    { file: "build.gradle.kts", pattern: "quarkus" },
  ];
  for (const { file, pattern } of candidates) {
    const p = resolve(dir, file);
    if (existsSync(p)) {
      try {
        if (readFileSync(p, "utf8").includes(pattern)) return true;
      } catch {
        // ignore read errors
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jbangBin(): string {
  // jbang may not be on PATH inside pi's spawned env; fall back to common locations.
  const candidates = [
    `${process.env.HOME}/.sdkman/candidates/jbang/current/bin/jbang`,
    "/usr/local/bin/jbang",
    "/opt/homebrew/bin/jbang",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "jbang"; // rely on PATH as a last resort
}

/** Resolve the project directory (cwd of the pi session). */
function projectDir(ctx: { cwd: string }): string {
  return resolve(ctx.cwd);
}

/**
 * Wrap a raw timeout around a Promise.
 * Rejects with a TimeoutError if the promise doesn't settle in time.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out waiting for ${label} (${ms}ms)`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// ---------------------------------------------------------------------------
// UI types
// ---------------------------------------------------------------------------

/** UI surface needed by the status-bar and log-widget polling loops. */
interface PollingUi {
  setStatus: (key: string, value: string | undefined) => void;
  setWidget: (key: string, lines: string[] | undefined) => void;
}

/** Full UI surface used by command handlers and lifecycle notifications. */
interface CommandUi extends PollingUi {
  notify: (msg: string, level: string) => void;
  confirm: (title: string, msg: string) => Promise<boolean>;
  select: (title: string, options: string[]) => Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// Extension state
// ---------------------------------------------------------------------------

type AppState = "running" | "starting" | "crashed" | "stopped";

interface QuarkusState {
  client: McpClient | null;
  /** In-flight startup promise — prevents concurrent callers from spawning multiple MCP processes. */
  pendingStart: Promise<McpClient> | null;
  /** Tool names registered in this process (idempotent across session restarts). */
  registeredToolNames: Set<string>;
  /** Interval handle for the app-status polling loop. */
  statusPoller: ReturnType<typeof setInterval> | null;
  /** Interval handle for the log-widget polling loop (active only while app is starting). */
  logPoller: ReturnType<typeof setInterval> | null;
  /** Accumulated startup log lines collected while the app is in the starting state. */
  startupLogLines: string[];
  /** Timestamp (ms) when the current starting phase began — used to filter log lines. */
  startupBeganAt: number;
  /** Last observed app state — used to detect transitions (e.g. starting → crashed). */
  lastAppState: AppState | null;
  /** Whether we have already enabled app file logging in this session. */
  appLogEnabled: boolean;
}

/**
 * Per-tool prompt guidelines injected into the system prompt when the tool is active.
 * Use these to reinforce the guardrails from the MCP tool descriptions.
 */
const TOOL_GUIDELINES: Record<string, string[]> = {
  quarkus_start: [
    "NEVER run `mvn quarkus:dev`, `./mvnw quarkus:dev`, or any equivalent shell command — quarkus_start is the only correct way to start dev mode.",
    "After any structural change (adding extensions, new endpoints), update README.md.",
    "Always write tests for every feature unless the user explicitly says not to.",
  ],
  quarkus_stop: [
    "Use quarkus_stop to stop a running Quarkus dev-mode application. Do not kill the process manually.",
  ],
  quarkus_restart: [
    "Only use quarkus_restart if the app is unresponsive. Hot reload handles code changes automatically — do not restart just because files changed.",
    "If the test runner is stuck with 'Tests already in progress', use quarkus_callTool with toolName 'devui-testing_resetTests' first. Only fall back to quarkus_stop + quarkus_start if that doesn't recover it.",
    "To trigger a hot reload without a full restart, use quarkus_callTool with toolName 'devui-logstream_forceRestart'.",
  ],
  quarkus_create: [
    "NEVER implement a feature manually when a Quarkus extension exists for it — always search for the right extension first using quarkus_searchTools with query='extension'.",
    "Before creating the app or writing ANY code, use quarkus_searchDocs to discover all extensions that fulfil each requested capability. Present the full list to the user with a recommended default and WAIT for their choice. Never silently pick one.",
    "Call quarkus_skills for each chosen extension BEFORE writing any code — this is mandatory.",
    "Always write tests for every feature unless the user explicitly says not to.",
    "Keep README.md updated with the app description, features, endpoints, and Quarkus guide links after every change.",
  ],
  quarkus_callTool: [
    "Call quarkus_searchTools first to discover the correct tool name and parameters before invoking quarkus_callTool.",
    "NEVER run 'mvn clean' or 'gradle clean' while dev mode is running — it deletes target/test-classes and breaks the test runner.",
    "If the test runner returns 'Tests already in progress', call quarkus_callTool with toolName 'devui-testing_resetTests' to recover it. Only do a full quarkus_stop + quarkus_start if reset fails.",
    "Prefer devui-testing_runAffectedTests over devui-testing_runTests during iterative development — it only runs tests affected by recent changes.",
    "For exceptions, use devui-exceptions_getLastException for structured details (class, message, stack trace). Call devui-exceptions_clearLastException after handling to avoid seeing the same exception again.",
  ],
  quarkus_searchTools: [
    "The Dev MCP tool list is dynamic — it changes when extensions are added or removed. Re-call quarkus_searchTools after any extension change.",
    "Always call quarkus_searchTools before interacting with the running app for testing, config, extensions, endpoints, or dev services.",
  ],
  quarkus_skills: [
    "ALWAYS call quarkus_skills for each extension BEFORE writing code or tests — this is mandatory, not optional.",
    "quarkus_skills does not require the app to be running.",
  ],
  quarkus_update: [
    "For existing Quarkus projects, ALWAYS call quarkus_update (via a subagent if supported) BEFORE starting any development work to ensure the project is on the latest version.",
  ],
  quarkus_logs: [
    "For structured exception details (class, message, stack trace, user code location), prefer quarkus_callTool with toolName 'devui-exceptions_getLastException' over quarkus_logs.",
  ],
};

/** Convert an MCP inputSchema to a minimal TypeBox-compatible schema. */
function toTypeBox(inputSchema: Record<string, unknown>): ReturnType<typeof Type.Object> {
  const props = inputSchema.properties as Record<string, unknown> | undefined;
  if (!props || Object.keys(props).length === 0) {
    return Type.Object({});
  }

  const required = new Set<string>(
    Array.isArray(inputSchema.required) ? (inputSchema.required as string[]) : [],
  );

  const fields: Record<string, ReturnType<typeof Type.Unknown>> = {};
  for (const [key, schema] of Object.entries(props)) {
    const s = schema as Record<string, unknown>;
    const description = typeof s.description === "string" ? s.description : undefined;
    const base = description ? Type.Unknown({ description }) : Type.Unknown();
    fields[key] = required.has(key) ? base : Type.Optional(base);
  }

  return Type.Object(fields);
}

/** Format the tool call arguments compactly for the renderCall line. */
function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ")
    .slice(0, 120);
}

// ---------------------------------------------------------------------------
// Info renderer
// ---------------------------------------------------------------------------

const QUARKUS_INFO_MSG_TYPE = "quarkus-info";

interface InfoDetails {
  status: string;
  endpoints: Array<{ uri: string; description?: string }>;
  devServices: Array<{
    name: string;
    imageName?: string;
    containerStatus?: string;
    port?: { public: number; private: number };
    configs: Record<string, string>;
  }>;
}

function renderInfoMessage(
  details: Record<string, unknown>,
  theme: { fg: (color: string, text: string) => string; bold: (text: string) => string },
): Text {
  const d = details as unknown as InfoDetails;
  const lines: string[] = [];

  // ── Status ──────────────────────────────────────────────────────────────
  const running = d.status.includes("running");
  const portMatch = d.status.match(/port:\s*(\d+)/);
  const statusIcon = running ? theme.fg("success", "●") : theme.fg("warning", "◌");
  const statusText = running
    ? theme.fg("success", "running") + (portMatch ? theme.fg("muted", ` :${portMatch[1]}`) : "")
    : theme.fg("warning", d.status);
  lines.push(theme.fg("accent", theme.bold("Quarkus")) + "  " + statusIcon + " " + statusText);

  // ── Endpoints ────────────────────────────────────────────────────────────
  if (d.endpoints.length > 0) {
    lines.push("");
    lines.push(theme.fg("borderAccent", "Endpoints"));
    for (const e of d.endpoints) {
      const desc = e.description ? theme.fg("text", e.description) : "";
      const uri  = theme.fg("muted", e.uri);
      lines.push("  " + (desc ? desc + "  " + uri : uri));
    }
  }

  // ── Dev Services ─────────────────────────────────────────────────────────
  if (d.devServices.length > 0) {
    lines.push("");
    lines.push(theme.fg("borderAccent", "Dev Services"));
    for (const s of d.devServices) {
      lines.push("  " + theme.fg("text", theme.bold(s.name)));
      if (s.imageName)       lines.push("    " + theme.fg("dim", "image  ") + theme.fg("muted", s.imageName));
      if (s.containerStatus) lines.push("    " + theme.fg("dim", "status ") + theme.fg("muted", s.containerStatus));
      if (s.port)            lines.push("    " + theme.fg("dim", "port   ") + theme.fg("muted", `${s.port.public} → ${s.port.private}`));
      for (const [k, v] of Object.entries(s.configs)) {
        lines.push("    " + theme.fg("dim", "config ") + theme.fg("muted", `${k} = ${v}`));
      }
    }
  }

  return new Text(lines.join("\n"), 1, 1);
}

function parseInfoDetails(statusRaw: string, endpointsRaw: string, devServicesRaw: string): InfoDetails {
  // Endpoints
  let endpoints: InfoDetails["endpoints"] = [];
  try {
    const data = JSON.parse(endpointsRaw) as Record<string, Array<{ uri: string; description?: string }>>;
    endpoints = Object.values(data).flat();
  } catch { /* leave empty */ }

  // Dev Services
  let devServices: InfoDetails["devServices"] = [];
  try {
    const raw = JSON.parse(devServicesRaw) as Array<{
      name: string;
      configs?: Record<string, string>;
      containerInfo?: {
        imageName?: string;
        status?: string;
        exposedPorts?: Array<{ ip: string; privatePort: number; publicPort: number }>;
      };
    }>;
    devServices = raw.map((s) => {
      const port = s.containerInfo?.exposedPorts?.find((p) => p.ip === "0.0.0.0");
      return {
        name: s.name,
        imageName: s.containerInfo?.imageName,
        containerStatus: s.containerInfo?.status,
        port: port ? { public: port.publicPort, private: port.privatePort } : undefined,
        configs: s.configs ?? {},
      };
    });
  } catch { /* leave empty */ }

  return { status: statusRaw, endpoints, devServices };
}

// ---------------------------------------------------------------------------
// Test result renderer
// ---------------------------------------------------------------------------

const QUARKUS_STARTUP_LOG_MSG_TYPE = "quarkus-startup-log";
const QUARKUS_TEST_MSG_TYPE = "quarkus-test";

function parseTestSummary(text: string): { passed: number; failed: number; total: number } | null {
  const jsonMatch = text.match(/{[\s\S]*}/m);
  if (!jsonMatch) return null;
  try {
    const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const passed = Number(data["passedCount"] ?? data["passed"] ?? 0);
    const failed = Number(data["failedCount"] ?? data["failed"] ?? 0);
    const total  = Number(data["total"]       ?? passed + failed);
    if (Number.isNaN(passed) || Number.isNaN(failed)) return null;
    return { passed, failed, total };
  } catch {
    return null;
  }
}

function renderStartupLog(
  details: Record<string, unknown>,
  theme: { fg: (color: string, text: string) => string; bold: (text: string) => string },
  expanded: boolean,
): Text {
  const log = (details.log as string) ?? "";
  const outcome = details.outcome as "running" | "crashed";
  const lines = log.split("\n");
  const icon = outcome === "running" ? theme.fg("success", "●") : theme.fg("error", "⚠");
  const label = outcome === "running"
    ? theme.fg("success", "Quarkus started")
    : theme.fg("error",   "Quarkus crashed");
  const header = `${icon} ${label}  ${theme.fg("muted", `${lines.length} lines`)}`;
  if (expanded) {
    return new Text([header, theme.fg("dim", log)].join("\n"), 0, 0);
  }
  const preview = lines.slice(0, PREVIEW_LINES).join("\n");
  const remaining = lines.length - PREVIEW_LINES;
  const hint = remaining > 0
    ? "\n" + theme.fg("dim", keyHint("app.tools.expand", `to see ${remaining} more lines`))
    : "";
  return new Text([header, theme.fg("dim", preview)].join("\n") + hint, 0, 0);
}

function renderTestResult(
  details: Record<string, unknown>,
  theme: { fg: (color: string, text: string) => string; bold: (text: string) => string },
  expanded: boolean,
): Text {
  const raw = (details.raw as string) ?? "";
  const summary = parseTestSummary(raw);

  if (!summary) {
    return new Text(theme.fg("warning", "test: result unavailable"), 0, 0);
  }

  const { passed, failed, total } = summary;
  const icon   = failed > 0 ? theme.fg("error", "✗") : theme.fg("success", "✓");
  const counts = failed > 0
    ? theme.fg("error",   `${failed} failed`) + theme.fg("muted", ` / ${total} total`)
    : theme.fg("success", `${passed} passed`) + (total > passed ? theme.fg("muted", ` / ${total} total`) : "");

  if (!expanded) {
    const hint = theme.fg("dim", keyHint("app.tools.expand", "to expand"));
    return new Text(`${icon} ${counts}  ${hint}`, 0, 0);
  }

  return new Text([`${icon} ${counts}`, theme.fg("dim", raw)].join("\n"), 0, 0);
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default async function (pi: ExtensionAPI) {
  pi.registerMessageRenderer(QUARKUS_INFO_MSG_TYPE, (message, _options, theme) =>
    renderInfoMessage(message.details as Record<string, unknown>, theme),
  );

  pi.registerMessageRenderer(QUARKUS_STARTUP_LOG_MSG_TYPE, (message, options, theme) =>
    renderStartupLog(message.details as Record<string, unknown>, theme, options.expanded),
  );

  pi.registerMessageRenderer(QUARKUS_TEST_MSG_TYPE, (message, options, theme) =>
    renderTestResult(message.details as Record<string, unknown>, theme, options.expanded),
  );

  const state: QuarkusState = {
    client: null,
    pendingStart: null,
    registeredToolNames: new Set(),
    statusPoller: null,
    logPoller: null,
    startupLogLines: [],
    startupBeganAt: 0,
    lastAppState: null,
    appLogEnabled: false,
  };

  // -------------------------------------------------------------------------
  // Start / stop the MCP server
  // -------------------------------------------------------------------------

  async function startClient(cwd: string): Promise<McpClient> {
    const jbang = jbangBin();
    const c = new McpClient(
      jbang,
      [JBANG_ALIAS],
      cwd,
      { AGENT_MCP_PROJECT_DIR: cwd },
    );

    c.addCloseListener(() => {
      if (state.client === c) {
        state.client = null;
        state.pendingStart = null;
      }
    });

    await withTimeout(c.waitReady(), STARTUP_TIMEOUT_MS, "quarkus-agent-mcp startup");
    return c;
  }

  async function ensureClient(cwd: string): Promise<McpClient> {
    if (!state.client) {
      if (!state.pendingStart) {
        state.pendingStart = startClient(cwd).then((c) => {
          state.client = c;
          state.pendingStart = null;
          registerMcpTools(c.tools, cwd);
          return c;
        });
      }
      return state.pendingStart;
    }
    return state.client;
  }

  // -------------------------------------------------------------------------
  // Call an MCP tool and return its text output — throw on error
  // -------------------------------------------------------------------------

  async function callMcpTool(toolName: string, args: Record<string, unknown>, cwd: string): Promise<string> {
    const c = await ensureClient(cwd);
    const result = await c.callTool(toolName, args);
    const text = extractText(result);
    if (result.isError) throw new Error(text || `${toolName} failed`);
    return text;
  }

  // -------------------------------------------------------------------------
  // Register each MCP tool as a pi tool
  // -------------------------------------------------------------------------

  function registerMcpTools(tools: McpTool[], cwd: string): void {
    for (const tool of tools) {
      if (state.registeredToolNames.has(tool.name)) continue;
      state.registeredToolNames.add(tool.name);

      const parameters = toTypeBox(tool.inputSchema);

      pi.registerTool({
        name: tool.name,
        label: tool.name.replace(/_/g, " "),
        description: tool.description ?? tool.name,
        promptSnippet: tool.description?.split(".")[0] ?? tool.name,
        promptGuidelines: TOOL_GUIDELINES[tool.name],
        parameters,

        async execute(toolCallId, params, signal, onUpdate) {
          const c = await ensureClient(cwd);

          // Stream a working indicator while we wait
          onUpdate?.({
            content: [{ type: "text", text: `Running ${tool.name}…` }],
          });

          const rawArgs = params as Record<string, unknown>;
          // Strip undefined values before sending to MCP server
          const args: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rawArgs)) {
            if (v !== undefined) args[k] = v;
          }

          const result = await c.callTool(tool.name, args, signal);

          // Truncate large outputs to protect LLM context
          const truncation = truncateTail(extractText(result), {
            maxLines: DEFAULT_MAX_LINES,
            maxBytes: DEFAULT_MAX_BYTES,
          });

          let output = truncation.content;
          if (truncation.truncated) {
            output += `\n\n[Output truncated: showing last ${truncation.outputLines} of ${truncation.totalLines} lines]`;
          }

          if (result.isError) {
            throw new Error(output || `${tool.name} failed`);
          }

          return {
            content: [{ type: "text", text: output }],
            details: { tool: tool.name, truncated: truncation.truncated },
          };
        },

        renderCall(args, theme) {
          let text = theme.fg("toolTitle", theme.bold(tool.name));
          const argStr = formatArgs(args as Record<string, unknown>);
          if (argStr) text += theme.fg("muted", ` ${argStr}`);
          return new Text(text, 0, 0);
        },

        renderResult(result, { isPartial, expanded }, theme) {
          if (isPartial) {
            return new Text(theme.fg("warning", "Running…"), 0, 0);
          }
          const d = result.details as { truncated?: boolean } | undefined;
          const rawText = result.content[0]?.type === "text" ? (result.content[0].text as string) : "";
          const lines = rawText.split("\n");
          const suffix = d?.truncated ? "\n" + theme.fg("warning", "[output truncated]") : "";
          if (expanded || lines.length <= PREVIEW_LINES) {
            return new Text(theme.fg("success", "✓ ") + theme.fg("dim", rawText) + suffix, 0, 0);
          }
          const preview = lines.slice(0, PREVIEW_LINES).join("\n");
          const remaining = lines.length - PREVIEW_LINES;
          const hint = "\n" + theme.fg("dim", keyHint("app.tools.expand", `to see ${remaining} more lines`));
          return new Text(theme.fg("success", "✓ ") + theme.fg("dim", preview) + hint, 0, 0);
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // LLM hand-off helpers
  // -------------------------------------------------------------------------

  function handOffSuccess(sub: string, output: string): void {
    pi.sendUserMessage(
      `\`/quarkus ${sub}\` completed. Here is the output:\n\n\`\`\`\n${output}\n\`\`\`\n\nPlease summarise the key findings and suggest any recommended next steps.`,
      { deliverAs: "followUp" },
    );
  }

  function handOffFailure(sub: string, error: string): void {
    pi.sendUserMessage(
      `\`/quarkus ${sub}\` failed. Here is the output:\n\n\`\`\`\n${error}\n\`\`\`\n\nWhat went wrong and how should I fix it?`,
      { deliverAs: "followUp" },
    );
  }

  // -------------------------------------------------------------------------
  // Dev-mode guard
  // -------------------------------------------------------------------------

  /**
   * Ensures the Quarkus app is running in dev mode.
   * Returns true if the app is (now) running, false if the user declined to start it.
   */
  async function ensureDevMode(cwd: string, ctx: { ui: CommandUi }): Promise<boolean> {
    let appRunning = false;
    try {
      const statusText = await callMcpTool("quarkus_status", { projectDir: cwd }, cwd);
      appRunning = statusText.includes("running");
    } catch {
      // If status check fails, assume not running.
    }
    if (appRunning) return true;

    const ok = await ctx.ui.confirm(
      "Quarkus not running",
      "The app is not running in dev mode. Start it now?",
    );
    if (!ok) return false;

    ctx.ui.setStatus("quarkus", "quarkus start…");
    try {
      await callMcpTool("quarkus_start", { projectDir: cwd }, cwd);
      ctx.ui.setStatus("quarkus", undefined);
      ctx.ui.notify("Quarkus started.", "info");
      return true;
    } catch (err) {
      ctx.ui.setStatus("quarkus", undefined);
      ctx.ui.notify(`Failed to start Quarkus: ${(err as Error).message}`, "error");
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle — app-status polling
  // -------------------------------------------------------------------------

  function parseAppState(text: string): AppState {
    if (text.match(/port:\s*\d+/)) return "running";
    if (text.includes("starting")) return "starting";
    if (text.includes("crashed")) return "crashed";
    return "stopped";
  }

  function updateFooterStatus(newState: AppState, text: string, ctx: { ui: PollingUi }): void {
    const portMatch = text.match(/port:\s*(\d+)/);
    if (newState === "running" && portMatch) {
      ctx.ui.setStatus("quarkus-app", `quarkus ● :${portMatch[1]}`);
    } else if (newState === "starting") {
      ctx.ui.setStatus("quarkus-app", "quarkus ◌ starting…");
    } else if (newState === "crashed") {
      ctx.ui.setStatus("quarkus-app", "quarkus ⚠ crashed");
    } else {
      ctx.ui.setStatus("quarkus-app", undefined);
    }
  }

  function onEnteringStarting(cwd: string, ctx: { ui: PollingUi }): void {
    state.startupBeganAt = Date.now();
    state.startupLogLines = [];
    if (state.logPoller) clearInterval(state.logPoller);
    state.logPoller = setInterval(() => { refreshLogWidget(cwd, ctx).catch(() => {}); }, 250);
    refreshLogWidget(cwd, ctx).catch(() => {});
  }

  async function onLeavingStarting(cwd: string, ctx: { ui: PollingUi }, outcome: "running" | "crashed"): Promise<void> {
    if (state.logPoller) { clearInterval(state.logPoller); state.logPoller = null; }
    ctx.ui.setWidget("quarkus-log", undefined);
    let finalLines = state.startupLogLines;
    try {
      const text = await callMcpTool("quarkus_app_log", { projectDir: cwd }, cwd);
      finalLines = filterLogSince(text.split("\n").filter((l) => l.trim() !== ""), state.startupBeganAt);
    } catch { /* fall back to accumulated lines */ }
    pi.sendMessage(
      { customType: QUARKUS_STARTUP_LOG_MSG_TYPE, content: "", display: true, details: { log: finalLines.join("\n"), outcome } },
      { triggerTurn: false },
    );
  }

  async function onCrashed(cwd: string): Promise<void> {
    let logOutput = "(log unavailable)";
    let exceptionOutput = "(unavailable)";
    await Promise.allSettled([
      callMcpTool("quarkus_app_log", { projectDir: cwd }, cwd)
        .then((text) => { logOutput = text || logOutput; }),
      callMcpTool("quarkus_callTool", { projectDir: cwd, toolName: "devui-exceptions_getLastException", maxCauseDepth: "5" }, cwd)
        .then((text) => { exceptionOutput = text || exceptionOutput; }),
    ]);
    pi.sendUserMessage(
      `Quarkus dev mode has crashed.\n\n**Last exception:**\n\`\`\`\n${exceptionOutput}\n\`\`\`\n\n**Recent logs:**\n\`\`\`\n${logOutput}\n\`\`\`\n\nWhat went wrong and how should I fix it?`,
      { deliverAs: "followUp" },
    );
  }

  /** Poll the app log and update the log widget above the editor. */
  async function refreshLogWidget(cwd: string, ctx: { ui: PollingUi }): Promise<void> {
    if (!state.client) return;
    try {
      const text = await callMcpTool("quarkus_app_log", { projectDir: cwd }, cwd);
      const lines = text.split("\n").filter((l) => l.trim() !== "");
      state.startupLogLines = filterLogSince(lines, state.startupBeganAt);
      ctx.ui.setWidget("quarkus-log", state.startupLogLines);
    } catch {
      // ignore — widget just won't update
    }
  }

  /** Update the footer status widget with the current app state. */
  async function refreshAppStatus(cwd: string, ctx: { ui: PollingUi }): Promise<void> {
    if (!state.client) return;
    try {
      const text = await callMcpTool("quarkus_status", { projectDir: cwd }, cwd);
      const newState = parseAppState(text);
      updateFooterStatus(newState, text, ctx);

      if ((newState === "starting" || newState === "running") && !state.appLogEnabled) {
        state.appLogEnabled = true;
        callMcpTool("quarkus_app_log_enable", { projectDir: cwd }, cwd).catch(() => {});
      }
      if (newState === "starting" && state.lastAppState !== "starting") {
        onEnteringStarting(cwd, ctx);
      }
      if (newState !== "starting" && state.lastAppState === "starting") {
        await onLeavingStarting(cwd, ctx, newState === "running" ? "running" : "crashed");
      }
      if (newState === "crashed" && state.lastAppState !== "crashed") {
        await onCrashed(cwd);
      }
      state.lastAppState = newState;
    } catch {
      // MCP error — clear rather than show stale state
      ctx.ui.setStatus("quarkus-app", undefined);
    }
  }

  // -------------------------------------------------------------------------
  // /quarkus command — subcommand handlers
  // -------------------------------------------------------------------------

  const DIRECT_SUBCOMMANDS = ["status", "start", "stop", "logs", "restart", "open", "devui"] as const;
  const LLM_SUBCOMMANDS    = ["update", "search-tools"] as const;
  const TEST_SUBCOMMANDS   = ["test-affected", "test-all"] as const;
  const ALL_SUBCOMMANDS    = [...DIRECT_SUBCOMMANDS, ...LLM_SUBCOMMANDS, ...TEST_SUBCOMMANDS, "info", "mcp-restart", "mcp-tools"] as const;
  type Subcommand = (typeof ALL_SUBCOMMANDS)[number];

  /** Map user-facing subcommand → MCP tool name. */
  const TOOL_NAME: Record<string, string> = {
    status:  "quarkus_status",
    start:   "quarkus_start",
    stop:    "quarkus_stop",
    logs:    "quarkus_logs",
    open:    "quarkus_open",
    devui:   "quarkus_devui",
    restart: "quarkus_restart",
    update:          "quarkus_update",
    "search-tools":  "quarkus_searchTools",
    "test-affected": "quarkus_callTool",
    "test-all":      "quarkus_callTool",
  };

  /** Build the MCP arguments for a subcommand, given optional extra args from the user. */
  function buildArgs(sub: string, cwd: string, extra?: string): Record<string, unknown> {
    if (sub === "test-affected") {
      return { projectDir: cwd, toolName: "devui-testing_runAffectedTests" };
    }
    if (sub === "test-all") {
      return { projectDir: cwd, toolName: "devui-testing_runTests" };
    }
    if (sub === "search-tools" && extra) {
      return { projectDir: cwd, query: extra };
    }
    return { projectDir: cwd };
  }

  /**
   * Subcommands that require the Quarkus app to already be running in dev mode.
   * If the app is not running, the user is offered to start it first.
   */
  const REQUIRES_DEV_MODE = new Set(["devui", "open", "restart", "search-tools"]);

  async function handleInfo(cwd: string, ctx: { ui: CommandUi }): Promise<void> {
    const running = await ensureDevMode(cwd, ctx);
    if (!running) return;
    ctx.ui.setStatus("quarkus", "quarkus info…");
    const [statusRes, endpointsRes, devServicesRes] = await Promise.allSettled([
      callMcpTool("quarkus_status", { projectDir: cwd }, cwd),
      callMcpTool("quarkus_callTool", { projectDir: cwd, toolName: "devui-endpoints_getAllEndpoints" }, cwd),
      callMcpTool("quarkus_callTool", { projectDir: cwd, toolName: "devui-dev-services_getDevServices" }, cwd),
    ]);
    ctx.ui.setStatus("quarkus", undefined);

    const statusRaw      = statusRes.status      === "fulfilled" ? statusRes.value      : "";
    const endpointsRaw   = endpointsRes.status   === "fulfilled" ? endpointsRes.value   : "{}";
    const devServicesRaw = devServicesRes.status  === "fulfilled" ? devServicesRes.value : "[]";

    pi.sendMessage(
      { customType: QUARKUS_INFO_MSG_TYPE, content: "", display: true, details: parseInfoDetails(statusRaw, endpointsRaw, devServicesRaw) },
      { triggerTurn: false },
    );
  }

  function handleMcpTools(ctx: { ui: CommandUi }): void {
    if (!state.client) {
      ctx.ui.notify("MCP server is not running — use /quarkus start first", "warning");
      return;
    }
    const lines = state.client.tools.map(
      (t) => `${t.name}\n  ${t.description ?? "(no description)"}`,
    );
    handOffSuccess("mcp-tools", lines.join("\n\n"));
  }

  async function handleMcpRestart(cwd: string, ctx: { ui: CommandUi }): Promise<void> {
    if (state.client) {
      await state.client.close().catch(() => {});
      state.client = null;
      state.pendingStart = null;
    }
    ctx.ui.setStatus("quarkus", "quarkus: restarting…");
    try {
      const c = await ensureClient(cwd);
      ctx.ui.setStatus("quarkus", undefined);
      ctx.ui.notify(`quarkus restarted: ${c.tools.length} tools`, "info");
    } catch (err) {
      ctx.ui.setStatus("quarkus", undefined);
      ctx.ui.notify(`quarkus restart failed: ${(err as Error).message}`, "error");
    }
  }

  async function handleSelector(ctx: { ui: CommandUi }): Promise<void> {
    const LABELS: Record<string, string> = {
      status:          "status        - Show app status",
      start:           "start         - Start app in dev mode",
      stop:            "stop          - Stop the running app",
      logs:            "logs          - Show recent log output",
      open:            "open          - Open the app in the browser",
      devui:           "devui         - Open the Dev UI in the browser",
      update:          "update           - Check for Quarkus updates (LLM)",
      "search-tools":  "search-tools     - Discover Dev MCP tools on the running app (LLM)",
      "test-affected": "test-affected    - Run affected tests (LLM)",
      "test-all":      "test-all         - Run full test suite (LLM)",
      restart:         "restart       - Restart the app (hot reload)",
      info:            "info          - Show app status, endpoints, and dev services",
      "mcp-restart":   "mcp-restart   - Restart the quarkus-agent-mcp server",
      "mcp-tools":     "mcp-tools     - List all tools advertised by the MCP server",
    };
    const labels = ALL_SUBCOMMANDS.map((s) => LABELS[s]);
    const chosen = await ctx.ui.select("Quarkus action", labels);
    if (!chosen) return;
    const chosenSub = chosen.split(" ")[0] as Subcommand;
    pi.sendUserMessage(`/quarkus ${chosenSub}`, { deliverAs: "followUp" });
  }

  async function handleTestSubcommand(sub: string, cwd: string, ctx: { ui: CommandUi }): Promise<void> {
    const running = await ensureDevMode(cwd, ctx);
    if (!running) return;
    const devuiTool = sub === "test-all"
      ? "devui-testing_runTests"
      : "devui-testing_runAffectedTests";
    ctx.ui.setStatus("quarkus", `quarkus ${sub}…`);
    let testOutput: string;
    let testFailed = false;
    try {
      testOutput = await callMcpTool("quarkus_callTool", { projectDir: cwd, toolName: devuiTool }, cwd);
    } catch (err) {
      testOutput = (err as Error).message;
      testFailed = true;
    } finally {
      ctx.ui.setStatus("quarkus", undefined);
    }
    const prompt = testFailed
      ? `Quarkus tests failed. Output:\n\n\`\`\`\n${testOutput}\n\`\`\`\n\nWhat went wrong and how should I fix it?`
      : `Quarkus tests completed. Output:\n\n\`\`\`\n${testOutput}\n\`\`\`\n\nPlease summarise the results and suggest any recommended next steps.`;
    pi.sendMessage(
      { customType: QUARKUS_TEST_MSG_TYPE, content: prompt, display: true, details: { raw: testOutput } },
      { triggerTurn: true, deliverAs: "followUp" },
    );
  }

  async function handleLlmSubcommand(sub: string, extra: string | undefined, cwd: string, ctx: { ui: CommandUi }): Promise<void> {
    const toolName = TOOL_NAME[sub];
    if (!toolName) {
      ctx.ui.notify(`Unknown subcommand: ${sub}`, "error");
      return;
    }
    if (REQUIRES_DEV_MODE.has(sub)) {
      const running = await ensureDevMode(cwd, ctx);
      if (!running) return;
    }
    ctx.ui.setStatus("quarkus", `quarkus ${sub}…`);
    try {
      const output = await callMcpTool(toolName, buildArgs(sub, cwd, extra), cwd);
      ctx.ui.setStatus("quarkus", undefined);
      handOffSuccess(sub, output);
    } catch (err) {
      ctx.ui.setStatus("quarkus", undefined);
      handOffFailure(sub, (err as Error).message);
    }
  }

  async function handleDirectSubcommand(sub: string, cwd: string, ctx: { ui: CommandUi }): Promise<void> {
    const toolName = TOOL_NAME[sub];
    if (!toolName) {
      ctx.ui.notify(`Unknown subcommand: ${sub}`, "error");
      return;
    }
    if (REQUIRES_DEV_MODE.has(sub)) {
      const running = await ensureDevMode(cwd, ctx);
      if (!running) return;
    }
    ctx.ui.setStatus("quarkus", `quarkus ${sub}…`);
    try {
      const output = await callMcpTool(toolName, buildArgs(sub, cwd), cwd);
      ctx.ui.setStatus("quarkus", undefined);
      // Show first PREVIEW_LINES lines as a notification, rest is available on demand
      const lines = output.split("\n");
      const preview = lines.slice(0, PREVIEW_LINES).join("\n") + (lines.length > PREVIEW_LINES ? "\n…" : "");
      ctx.ui.notify(preview || `${sub} OK`, "info");
    } catch (err) {
      ctx.ui.setStatus("quarkus", undefined);
      const errMsg = (err as Error).message;
      ctx.ui.notify(`${sub} failed – asking LLM for help…`, "warning");
      handOffFailure(sub, errMsg);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  pi.on("session_start", (_event, ctx) => {
    const cwd = projectDir(ctx);

    if (!isQuarkusProject(cwd)) return;

    ctx.ui.setStatus("quarkus", "quarkus: starting…");
    // Start the MCP server in the background so it doesn't block session startup.
    ensureClient(cwd)
      .then((c) => {
        ctx.ui.setStatus("quarkus", undefined);
        ctx.ui.notify(
          `quarkus: ${c.tools.length} tools loaded`,
          "info",
        );
        // Start polling app status every 5 seconds
        if (state.statusPoller) clearInterval(state.statusPoller);
        state.statusPoller = setInterval(() => { refreshAppStatus(cwd, ctx).catch(() => {}); }, 5_000);
        refreshAppStatus(cwd, ctx).catch(() => {});
      })
      .catch((err) => {
        ctx.ui.setStatus("quarkus", undefined);
        ctx.ui.notify(`quarkus: failed to start – ${(err as Error).message}`, "error");
      });
  });

  pi.on("session_shutdown", async () => {
    if (state.statusPoller) { clearInterval(state.statusPoller); state.statusPoller = null; }
    if (state.logPoller)    { clearInterval(state.logPoller);    state.logPoller    = null; }
    if (state.client) {
      await state.client.close().catch(() => {});
      state.client = null;
      state.pendingStart = null;
    }
  });

  // -------------------------------------------------------------------------
  // /quarkus command — direct MCP dispatch, LLM on failure
  // -------------------------------------------------------------------------

  pi.registerCommand("quarkus", {
    description: "Run a Quarkus action: status | start | stop | logs | update | test-affected | test-all | restart | info | mcp-restart | mcp-tools",

    getArgumentCompletions: (prefix: string) => {
      const filtered = ALL_SUBCOMMANDS.filter((s) => s.startsWith(prefix));
      return filtered.length > 0
        ? filtered.map((s) => ({
            value: s,
            label: s,
            description: {
              status:          "Show app status",
              start:           "Start app in dev mode",
              stop:            "Stop the running app",
              logs:            "Show recent log output",
              open:            "Open the app in the browser",
              devui:           "Open the Dev UI in the browser",
              update:          "Check for Quarkus updates (analysed by LLM)",
              "search-tools":  "Discover Dev MCP tools on the running app (analysed by LLM)",
              "test-affected": "Run tests affected by recent changes (results analysed by LLM)",
              "test-all":      "Run the full test suite (results analysed by LLM)",
              restart:         "Restart the app (hot reload)",
              info:            "Show app status, endpoints, and dev services",
              "mcp-restart":   "Restart the quarkus-agent-mcp server",
              "mcp-tools":     "List all tools advertised by the MCP server",
            }[s],
          }))
        : null;
    },

    handler: async (args, ctx) => {
      const cwd = projectDir(ctx);
      const [sub, ...extraParts] = (args?.trim() || "").split(/\s+/);
      const extra = extraParts.join(" ") || undefined;

      if (sub === "info")        return handleInfo(cwd, ctx);
      if (sub === "mcp-tools")   return handleMcpTools(ctx);
      if (sub === "mcp-restart") return handleMcpRestart(cwd, ctx);
      if (!sub)                  return handleSelector(ctx);

      // Ensure the MCP server is running before any tool call
      if (!state.client) {
        if (!isQuarkusProject(cwd)) {
          const ok = await ctx.ui.confirm(
            "Not a Quarkus project",
            "No Quarkus build file detected. Start quarkus-agent-mcp anyway?",
          );
          if (!ok) return;
        }
        ctx.ui.setStatus("quarkus", "quarkus: starting…");
        try {
          await ensureClient(cwd);
          ctx.ui.setStatus("quarkus", undefined);
        } catch (err) {
          ctx.ui.setStatus("quarkus", undefined);
          ctx.ui.notify(`quarkus failed to start: ${(err as Error).message}`, "error");
          return;
        }
      }

      if ((TEST_SUBCOMMANDS    as readonly string[]).includes(sub)) return handleTestSubcommand(sub, cwd, ctx);
      if ((LLM_SUBCOMMANDS     as readonly string[]).includes(sub)) return handleLlmSubcommand(sub, extra, cwd, ctx);
      if ((DIRECT_SUBCOMMANDS  as readonly string[]).includes(sub)) return handleDirectSubcommand(sub, cwd, ctx);

      ctx.ui.notify(
        `Unknown subcommand: "${sub}". Try: ${ALL_SUBCOMMANDS.join(", ")}`,
        "error",
      );
    },
  });
}
