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

import { existsSync, readFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { spawnSafe } from "./vendor/spawn-safe.ts";
import { join, relative, resolve } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  DynamicBorder,
  truncateTail,
  keyHint,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, type SelectItem, SelectList, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { McpClient, type McpTool } from "./mcp-client.js";
import { extractText } from "./utils.js";
import { filterDisplayOnlyMessages } from "./vendor/context-filter.ts";
import { buildProjectTree, findProjectRoot, pomHasPlugin, type ProjectNode } from "./vendor/maven-project-tree.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** The jbang alias that launches the quarkus-agent-mcp stdio server. */
const JBANG_ALIAS = "quarkus-agent-mcp@quarkusio";

/** How long (ms) to wait for the MCP server to initialise before giving up. */
const STARTUP_TIMEOUT_MS = 60_000;

/** Number of result/log lines shown in the collapsed message preview. */
const PREVIEW_LINES = 10;

/** Ignore agent-initiated lifecycle transitions for this long before treating changes as external. */
const LIFECYCLE_SUPPRESSION_MS = 30_000;

// ---------------------------------------------------------------------------
// Quarkus project detection
// ---------------------------------------------------------------------------

/** Returns true if the given directory contains a pom.xml with the quarkus-maven-plugin. */
function isQuarkusProject(dir: string): boolean {
  const pomPath = resolve(dir, "pom.xml");
  if (existsSync(pomPath) && pomHasPlugin(pomPath, "quarkus-maven-plugin")) return true;
  for (const gradle of ["build.gradle", "build.gradle.kts"]) {
    const p = resolve(dir, gradle);
    if (existsSync(p)) {
      try {
        if (readFileSync(p, "utf8").includes("quarkus")) return true;
      } catch { /* ignore */ }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the path to the jbang binary, checking well-known locations before
 * falling back to PATH. Returns null if jbang is definitely not installed.
 */
function jbangBin(): string | null {
  // jbang may not be on PATH inside pi's spawned env; check well-known locations.
  const candidates = [
    `${process.env.HOME}/.sdkman/candidates/jbang/current/bin/jbang`,
    `${process.env.HOME}/.jbang/bin/jbang`,
    "/usr/local/bin/jbang",
    "/opt/homebrew/bin/jbang",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Last resort: probe whether "jbang" actually resolves on PATH.
  // We cannot use existsSync for PATH entries, so we run "command -v jbang".
  try {
    execSync("command -v jbang", { stdio: "ignore" });
    return "jbang";
  } catch {
    return null;
  }
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

/** UI surface needed by the status-bar polling loop. */
interface PollingUi {
  setStatus: (key: string, value: string | undefined) => void;
}

/** Full UI surface used by command handlers and lifecycle notifications. */
interface CommandUi extends PollingUi {
  notify: (msg: string, level: string) => void;
  confirm: (title: string, msg: string) => Promise<boolean>;
  select: (title: string, options: string[]) => Promise<string | undefined>;
  custom: <T>(
    factory: (tui: { requestRender: () => void }, theme: any, keybindings: unknown, done: (result: T) => void) => {
      render: (width: number) => string[];
      invalidate: () => void;
      handleInput?: (data: string) => void;
    },
    options?: { overlay?: boolean },
  ) => Promise<T>;
}

// ---------------------------------------------------------------------------
// Extension state
// ---------------------------------------------------------------------------

type AppState = "running" | "starting" | "crashed" | "stopped";

interface LifecycleObservation {
  initialState: AppState;
  currentState: AppState;
  sawRunning: boolean;
  sawStopped: boolean;
}

interface QuarkusState {
  client: McpClient | null;
  /** In-flight startup promise — prevents concurrent callers from spawning multiple MCP processes. */
  pendingStart: Promise<McpClient> | null;
  /** Tool names registered in this process (idempotent across session restarts). */
  registeredToolNames: Set<string>;
  /** Interval handle for the app-status polling loop. */
  statusPoller: ReturnType<typeof setInterval> | null;
  /** Last observed app states for all discovered services. */
  instanceStates: Map<string, AppState>;
  /** Whether we have already enabled app file logging in this session. */
  appLogEnabled: boolean;
  /** Buffered externally-observed lifecycle changes to inject on the next turn. */
  pendingLifecycleChanges: Map<string, LifecycleObservation>;
  /** Temporary suppression window for agent-initiated lifecycle changes. */
  suppressedLifecycleChanges: Map<string, number>;
  /** Whether refreshAppStatus has already established a baseline service-state snapshot. */
  hasObservedStates: boolean;
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
    "When fetching skills for multiple extensions in one session, pass them as a single comma-separated query (e.g. query='panache,rest,hibernate-validator') — one call instead of many.",
    "quarkus_skills does not require the app to be running.",
    "To check if the project is up-to-date, call quarkus_skills with query='quarkus-update'. If the quarkus-update skill is not yet installed, call quarkus_installSkills with skillName='quarkus-update' first.",
  ],
  quarkus_logs: [
    "For structured exception details (class, message, stack trace, user code location), prefer quarkus_callTool with toolName 'devui-exceptions_getLastException' over quarkus_logs.",
  ],
  quarkus_agent_log: [
    "Use quarkus_agent_log with action 'enable' to start file logging to ~/.quarkus/agent-mcp/agent-mcp.log, then action 'read' to inspect it.",
    "Use quarkus_agent_log to diagnose MCP server startup failures or unexpected tool behaviour — it captures server-side logs invisible in stdio mode.",
  ],
  quarkus_updateSkill: [
    "Before writing, ALWAYS ask the user: should this ENHANCE the existing skill (append your content) or OVERRIDE it (fully replace)? Enhance is the default and recommended.",
    "quarkus_updateSkill writes to ~/.quarkus/skills/ — it affects ALL projects. For project-scoped customisation, use quarkus_saveSkill first to materialise the skill into .agent/skills/, then edit that file.",
  ],
  quarkus_saveSkill: [
    "quarkus_saveSkill materialises a composed skill into the project's .agent/skills/ directory so the user can inspect, edit, and version-control it.",
    "It will NOT overwrite an existing local skill file — safe to call even if the user has already customised it.",
    "Use this before quarkus_updateSkill when the user wants project-scoped (not global) skill customisation.",
  ],
};

/** Map a JSON Schema type string to the corresponding TypeBox type. */
function jsonSchemaTypeToTypeBox(
  schema: Record<string, unknown>,
  description?: string,
): ReturnType<typeof Type.Unknown> {
  const type = schema.type as string | string[] | undefined;
  const desc = description ?? (typeof schema.description === "string" ? schema.description : undefined);
  const opts: { description?: string } = desc ? { description: desc } : {};

  if (Array.isArray(type)) {
    // e.g. ["string", "null"] → pick the first non-null type
    const primary = type.find((t) => t !== "null") ?? type[0];
    return jsonSchemaTypeToTypeBox({ ...schema, type: primary }, desc);
  }

  switch (type) {
    case "string":  return desc ? Type.String(opts) : Type.String();
    case "number":  return desc ? Type.Number(opts) : Type.Number();
    case "integer": return desc ? Type.Integer(opts) : Type.Integer();
    case "boolean": return desc ? Type.Boolean(opts) : Type.Boolean();
    case "array":   return desc ? Type.Array(Type.Unknown(), opts) : Type.Array(Type.Unknown());
    case "object":  return desc ? Type.Object({}, opts) : Type.Object({});
    case "null":    return desc ? Type.Literal(null as any, opts) : Type.Literal(null as any);
    default:        return desc ? Type.Unknown(opts) : Type.Unknown();
  }
}

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
    const typeBoxType = jsonSchemaTypeToTypeBox(s);
    fields[key] = required.has(key) ? typeBoxType : Type.Optional(typeBoxType);
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
// jbang-missing error and renderer
// ---------------------------------------------------------------------------

/** Thrown when jbang is not found on the system. */
class JbangMissingError extends Error {
  constructor() {
    super("jbang is not installed");
    this.name = "JbangMissingError";
  }
}

// ---------------------------------------------------------------------------
// Install-jbang helpers
// ---------------------------------------------------------------------------

/** Returns the brew binary path if Homebrew is installed, otherwise null. */
function brewBin(): string | null {
  for (const p of ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Returns true if SDKman is installed. */
function hasSdkman(): boolean {
  return existsSync(`${process.env.HOME}/.sdkman/bin/sdkman-init.sh`);
}

interface InstallOption {
  label: string;
  description: string;
  /** Runs the installer and resolves when done, or rejects on failure. */
  install: () => Promise<{ output: string }>;
}

/** Returns the curl binary path if available, otherwise null. */
function curlBin(): string | null {
  for (const p of ["/usr/bin/curl", "/usr/local/bin/curl", "/opt/homebrew/bin/curl"]) {
    if (existsSync(p)) return p;
  }
  return null;
}


function jbangInstallOptions(): InstallOption[] {
  const options: InstallOption[] = [];

  const brew = brewBin();
  if (brew) {
    options.push({
      label: "Homebrew",
      description: `brew install jbangdev/tap/jbang`,
      install: () => runInstallCommand(brew, ["install", "jbangdev/tap/jbang"]),
    });
  }

  if (hasSdkman()) {
    options.push({
      label: "SDKman",
      description: `sdk install jbang`,
      install: () => runInstallCommand(
        "/bin/bash",
        ["-c", `source "${process.env.HOME}/.sdkman/bin/sdkman-init.sh" && sdk install jbang`],
      ),
    });
  }

  const curl = curlBin();
  if (curl) {
    options.push({
      label: "curl (universal)",
      description: "curl -Ls https://sh.jbang.dev | bash -s - app install jbang",
      install: () => runInstallCommand(
        "/bin/bash",
        ["-c", `set -o pipefail; "${curl}" -Ls https://sh.jbang.dev | bash -s - app install jbang`],
      ),
    });
  }

  return options;
}

/** Spawns a command and resolves when it exits with code 0, rejects otherwise. */
function runInstallCommand(cmd: string, args: string[]): Promise<{ output: string }> {
  return new Promise((resolve, reject) => {
    const { child, whenSpawnError } = spawnSafe(cmd, args, {
      stdio: "pipe",
      env: { ...process.env },
    });
    const chunks: string[] = [];
    child.stdout?.on("data", (d: Buffer) => chunks.push(d.toString()));
    child.stderr?.on("data", (d: Buffer) => chunks.push(d.toString()));
    const work = new Promise<{ output: string }>((res, rej) => {
      child.on("close", (code) => {
        const output = chunks.join("");
        if (code === 0) res({ output });
        else rej(new Error(`Installer exited with code ${code}:\n${output}`));
      });
    });
    Promise.race([work, whenSpawnError]).then(resolve, reject);
  });
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
    instanceStates: new Map(),
    appLogEnabled: false,
    pendingLifecycleChanges: new Map(),
    suppressedLifecycleChanges: new Map(),
    hasObservedStates: false,
  };

  // -------------------------------------------------------------------------
  // Start / stop the MCP server
  // -------------------------------------------------------------------------

  async function startClient(cwd: string, fresh = false): Promise<McpClient> {
    const jbang = jbangBin();
    if (!jbang) throw new JbangMissingError();
    const args = fresh ? ["--fresh", JBANG_ALIAS] : [JBANG_ALIAS];
    const c = new McpClient(
      jbang,
      args,
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

    ctx.ui.setStatus("quarkus", "[quarkus start…]");
    try {
      rememberAgentLifecycleChange(cwd);
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

  /**
   * Parse the JSON output of quarkus_list into a Map of projectDir → AppState.
   * Returns an empty Map for "No managed Quarkus instances" or any parse error.
   */
  function parseListOutput(text: string): Map<string, AppState> {
    const result = new Map<string, AppState>();
    try {
      const data = JSON.parse(text) as Record<string, string>;
      for (const [dir, status] of Object.entries(data)) {
        const s = status.toLowerCase();
        if (s === "running" || s === "starting" || s === "crashed" || s === "stopped") {
          result.set(dir, s as AppState);
        }
      }
    } catch {
      // non-JSON response (e.g. "No managed Quarkus instances") → empty map
    }
    return result;
  }

  /**
   * Format the footer status string for all non-stopped instances.
   * Returns undefined when there is nothing to show.
   * Format: quarkus[●blog ◌people ⚠api]
   */
  function formatFooterStatus(instances: Map<string, AppState>): string | undefined {
    // footer format: quarkus[●blog ◌people ⚠api]
    const ICON: Record<AppState, string> = {
      running:  "●",
      starting: "◌",
      crashed:  "⚠",
      stopped:  "",
    };
    const parts: string[] = [];
    for (const [dir, appState] of instances) {
      if (appState === "stopped") continue;
      const label = dir.split("/").at(-1) ?? dir;
      parts.push(`${ICON[appState]}${label}`);
    }
    if (parts.length === 0) return undefined;
    return `[quarkus ${parts.join(" ")}]`;
  }

  interface ServiceTarget {
    projectDir: string;
    label: string;
    relativeDir: string;
    appState: AppState;
    discovered: boolean;
  }

  function projectNodeLabel(node: ProjectNode): string {
    if (node.relativePath === ".") {
      return node.artifactId || (node.pomPath.split("/").at(-2) ?? ".");
    }
    return node.relativePath.split("/").at(-1) ?? node.artifactId;
  }

  function sortServiceTargets(services: ServiceTarget[]): ServiceTarget[] {
    return services.sort((left, right) => left.relativeDir.localeCompare(right.relativeDir));
  }

  function isQuarkusPom(pomPath: string): boolean {
    try {
      return readFileSync(pomPath, "utf8").includes("quarkus");
    } catch {
      return false;
    }
  }

  function collectQuarkusServiceNodes(node: ProjectNode, found: ProjectNode[] = []): ProjectNode[] {
    if (node.packaging !== "pom" && isQuarkusPom(node.pomPath)) {
      found.push(node);
    }
    for (const child of Object.values(node.modules ?? {})) {
      collectQuarkusServiceNodes(child, found);
    }
    return found;
  }

  function discoverQuarkusServices(cwd: string): ServiceTarget[] {
    const projectRoot = findProjectRoot(cwd);
    if (projectRoot) {
      try {
        const tree = buildProjectTree(projectRoot);
        const services = collectQuarkusServiceNodes(tree).map((node) => ({
          projectDir: resolve(projectRoot, node.relativePath),
          label: projectNodeLabel(node),
          relativeDir: node.relativePath,
          appState: "stopped" as AppState,
          discovered: true,
        }));
        if (services.length > 0) return sortServiceTargets(services);
      } catch {
        // fall through to single-project discovery
      }
    }

    if (!isQuarkusProject(cwd)) return [];
    return [{
      projectDir: cwd,
      label: cwd.split("/").at(-1) ?? cwd,
      relativeDir: ".",
      appState: "stopped",
      discovered: false,
    }];
  }

  function mergeServiceStates(cwd: string, instances: Map<string, AppState>): ServiceTarget[] {
    const merged = new Map<string, ServiceTarget>(
      discoverQuarkusServices(cwd).map((service) => [service.projectDir, service]),
    );

    for (const [projectDir, appState] of instances) {
      const existing = merged.get(projectDir);
      if (existing) {
        existing.appState = appState;
        continue;
      }
      merged.set(projectDir, {
        projectDir,
        label: projectDir.split("/").at(-1) ?? projectDir,
        relativeDir: relative(cwd, projectDir) || ".",
        appState,
        discovered: false,
      });
    }

    return sortServiceTargets(Array.from(merged.values()));
  }

  async function loadServiceTargets(cwd: string): Promise<ServiceTarget[]> {
    try {
      const text = await callMcpTool("quarkus_list", {}, cwd);
      return mergeServiceStates(cwd, parseListOutput(text));
    } catch {
      return discoverQuarkusServices(cwd);
    }
  }

  function runningServiceTargets(services: ServiceTarget[]): ServiceTarget[] {
    return services.filter((service) => service.appState !== "stopped");
  }

  function resolveServiceTargets(rawTargets: string, services: ServiceTarget[]): {
    resolved: ServiceTarget[];
    missing: string[];
    ambiguous: Array<{ token: string; matches: ServiceTarget[] }>;
  } {
    const resolved = new Map<string, ServiceTarget>();
    const missing: string[] = [];
    const ambiguous: Array<{ token: string; matches: ServiceTarget[] }> = [];

    const tokens = rawTargets
      .split(/[\s,]+/)
      .map((token) => token.trim().replace(/^\.\//, "").replace(/\/$/, ""))
      .filter((token) => token.length > 0);

    for (const token of tokens) {
      const matches = services.filter((service) =>
        service.projectDir === token || service.relativeDir === token || service.label === token,
      );
      const uniqueMatches = Array.from(new Map(matches.map((service) => [service.projectDir, service])).values());
      if (uniqueMatches.length === 0) {
        missing.push(token);
        continue;
      }
      if (uniqueMatches.length > 1) {
        ambiguous.push({ token, matches: uniqueMatches });
        continue;
      }
      const match = uniqueMatches[0];
      if (match) resolved.set(match.projectDir, match);
    }

    return {
      resolved: Array.from(resolved.values()),
      missing,
      ambiguous,
    };
  }

  function preferredServiceTarget(cwd: string, services: ServiceTarget[]): ServiceTarget | undefined {
    return services.find((service) => service.projectDir === cwd || service.relativeDir === ".");
  }

  async function selectServiceTarget(
    action: string,
    services: ServiceTarget[],
    ctx: { ui: CommandUi },
  ): Promise<ServiceTarget | null> {
    const items: SelectItem[] = services.map((service) => ({
      value: service.projectDir,
      label: service.label,
      description: service.relativeDir === service.label
        ? service.appState
        : `${service.relativeDir} • ${service.appState}`,
    }));

    const chosen = await ctx.ui.custom<string | null>(
      (tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
        container.addChild(new Text(theme.fg("accent", theme.bold(`Quarkus ${action}`)), 1, 0));
        const list = new SelectList(items, Math.min(items.length + 2, 15), {
          selectedPrefix: (t: string) => theme.fg("accent", t),
          selectedText:   (t: string) => theme.fg("accent", t),
          description:    (t: string) => theme.fg("muted",  t),
          scrollInfo:     (t: string) => theme.fg("dim",    t),
          noMatch:        (t: string) => theme.fg("warning", t),
        });
        list.onSelect = (item: { value: string }) => done(item.value);
        list.onCancel = () => done(null);
        container.addChild(list);
        container.addChild(new Text(
          theme.fg("dim", "↑↓ navigate • type to filter • enter select • esc cancel"),
          1, 0,
        ));
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
        return {
          render: (width: number) => container.render(width),
          invalidate: () => container.invalidate(),
          handleInput: (data: string) => { list.handleInput(data); tui.requestRender(); },
        };
      },
      { overlay: true },
    );

    return services.find((service) => service.projectDir === chosen) ?? null;
  }

  async function chooseServiceTarget(
    action: string,
    cwd: string,
    ctx: { ui: CommandUi; mode: string },
    rawTarget: string | undefined,
    services: ServiceTarget[],
  ): Promise<ServiceTarget | null | undefined> {
    if (rawTarget) {
      const { resolved, missing, ambiguous } = resolveServiceTargets(rawTarget, services);
      const problems = [
        ...missing.map((token) => `Unknown module: ${token}`),
        ...ambiguous.map(({ token, matches }) => `Ambiguous module: ${token} → ${matches.map((match) => match.relativeDir).join(", ")}`),
      ];
      if (resolved.length > 1) {
        problems.push(`Pick exactly one module for /quarkus ${action}: ${resolved.map((match) => match.relativeDir).join(", ")}`);
      }
      if (problems.length > 0) {
        ctx.ui.notify(problems.join("\n"), "error");
        return null;
      }
      return resolved[0];
    }

    const preferred = preferredServiceTarget(cwd, services);
    if (preferred) return preferred;
    if (services.length === 0) return undefined;
    if (services.length === 1) return services[0];
    if (ctx.mode !== "tui") {
      ctx.ui.notify(`Multiple Quarkus services are available. Pass a module name to /quarkus ${action}.`, "warning");
      return null;
    }
    return selectServiceTarget(action, services, ctx);
  }

  function parseStartArgs(rawArgs?: string): { target?: string; profiles?: string; error?: string } {
    if (!rawArgs) return {};

    let target: string | undefined;
    let profiles: string | undefined;

    for (const token of rawArgs.split(/\s+/).filter((part) => part.length > 0)) {
      if (token.startsWith("--profiles=")) {
        if (profiles !== undefined) return { error: "Only one --profiles=... argument is allowed." };
        profiles = token.slice("--profiles=".length);
        if (!profiles) return { error: "--profiles=... must not be empty." };
        continue;
      }
      if (token.startsWith("--")) {
        return { error: `Unknown /quarkus start option: ${token}` };
      }
      if (target !== undefined) {
        return { error: "Pass at most one module/path to /quarkus start." };
      }
      target = token.replace(/^\.\//, "").replace(/\/$/, "");
    }

    return { target, profiles };
  }

  function buildStartArgs(project: string, profiles?: string): Record<string, unknown> {
    return profiles ? { projectDir: project, mavenProfiles: profiles } : { projectDir: project };
  }

  function formatStatusLines(services: ServiceTarget[]): string {
    const ICON: Record<AppState, string> = {
      running: "●",
      starting: "◌",
      crashed: "⚠",
      stopped: "○",
    };
    if (services.length === 0) return "No Quarkus services discovered.";
    return services
      .map((service) => `${ICON[service.appState]} ${service.appState.padEnd(8)} ${service.relativeDir === "." ? service.label : service.relativeDir}`)
      .join("\n");
  }

  function rememberAgentLifecycleChange(projectDir: string): void {
    state.suppressedLifecycleChanges.set(projectDir, Date.now() + LIFECYCLE_SUPPRESSION_MS);
  }

  function suppressLifecycleChange(projectDir: string, nextState: AppState): boolean {
    const until = state.suppressedLifecycleChanges.get(projectDir);
    if (!until) return false;
    if (until <= Date.now()) {
      state.suppressedLifecycleChanges.delete(projectDir);
      return false;
    }
    if (nextState === "running" || nextState === "stopped" || nextState === "crashed") {
      state.suppressedLifecycleChanges.delete(projectDir);
    }
    return nextState !== "crashed";
  }

  function recordLifecycleChange(projectDir: string, previousState: AppState, nextState: AppState): void {
    if (previousState === nextState) return;
    if (suppressLifecycleChange(projectDir, nextState)) return;

    const existing = state.pendingLifecycleChanges.get(projectDir);
    const initialState = existing?.initialState ?? previousState;
    const observation: LifecycleObservation = {
      initialState,
      currentState: nextState,
      sawRunning: existing?.sawRunning ?? (initialState === "running"),
      sawStopped: existing?.sawStopped ?? (initialState === "stopped"),
    };
    if (nextState === "running") observation.sawRunning = true;
    if (nextState === "stopped") observation.sawStopped = true;
    if (previousState === "running") observation.sawRunning = true;
    if (previousState === "stopped") observation.sawStopped = true;
    state.pendingLifecycleChanges.set(projectDir, observation);
  }

  function serviceDisplayName(cwd: string, projectDir: string): string {
    const rel = relative(cwd, projectDir) || ".";
    return rel === "." ? (projectDir.split("/").at(-1) ?? projectDir) : rel;
  }

  function summarizeLifecycleObservation(cwd: string, projectDir: string, observation: LifecycleObservation): string {
    const name = serviceDisplayName(cwd, projectDir);
    if (observation.initialState === "running" && observation.currentState === "running" && observation.sawStopped) {
      return `${name} restarted`;
    }
    if (observation.currentState === "running") {
      return `${name} started`;
    }
    if (observation.initialState === "running" && observation.currentState === "stopped") {
      return `${name} stopped`;
    }
    if (observation.initialState === "stopped" && observation.currentState === "stopped" && observation.sawRunning) {
      return `${name} started and then stopped`;
    }
    if (observation.currentState === "starting") {
      return `${name} is starting`;
    }
    return `${name} changed state to ${observation.currentState}`;
  }

  function drainLifecycleSummary(cwd: string): string | undefined {
    if (state.pendingLifecycleChanges.size === 0) return undefined;
    const lines = Array.from(state.pendingLifecycleChanges.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([projectDir, observation]) => summarizeLifecycleObservation(cwd, projectDir, observation));
    state.pendingLifecycleChanges.clear();
    return lines.join("; ");
  }

  async function handleStatusSubcommand(cwd: string, ctx: { ui: CommandUi; mode: string }, extra?: string): Promise<void> {
    const services = await loadServiceTargets(cwd);
    if (extra) {
      const target = await chooseServiceTarget("status", cwd, ctx, extra, services);
      if (target === null) return;
      ctx.ui.notify(formatStatusLines(target ? [target] : []), "info");
      return;
    }
    ctx.ui.notify(formatStatusLines(services), "info");
  }

  async function handleStartSubcommand(cwd: string, ctx: { ui: CommandUi; mode: string }, rawArgs?: string): Promise<void> {
    const parsed = parseStartArgs(rawArgs);
    if (parsed.error) {
      ctx.ui.notify(parsed.error, "error");
      return;
    }

    const services = await loadServiceTargets(cwd);
    const target = await chooseServiceTarget("start", cwd, ctx, parsed.target, services);
    if (target === null) return;
    if (target === undefined) {
      ctx.ui.notify("No Quarkus services discovered.", "warning");
      return;
    }

    ctx.ui.setStatus("quarkus", "[quarkus start…]");
    try {
      rememberAgentLifecycleChange(target.projectDir);
      const output = await callMcpTool("quarkus_start", buildStartArgs(target.projectDir, parsed.profiles), cwd);
      ctx.ui.setStatus("quarkus", undefined);
      const outcome = output.includes("running") ? "running" : "crashed";
      pi.sendMessage(
        { customType: QUARKUS_STARTUP_LOG_MSG_TYPE, content: "", display: true, details: { log: output, outcome } },
        { triggerTurn: false },
      );
    } catch (err) {
      ctx.ui.setStatus("quarkus", undefined);
      const errMsg = (err as Error).message;
      ctx.ui.notify("start failed – asking LLM for help…", "warning");
      handOffFailure("start", errMsg);
    }
  }

  async function selectInstancesToStop(instances: ServiceTarget[], ctx: { ui: CommandUi }): Promise<ServiceTarget[] | null> {
    const selectedDirs = await ctx.ui.custom<string[] | null>(
      (tui, theme, _kb, done) => {
        let selected = new Set<string>();
        let cursor = 0;
        const maxVisibleRows = 10;
        const statusText: Record<AppState, string> = {
          running: "running",
          starting: "starting",
          crashed: "crashed",
          stopped: "stopped",
        };

        const list = {
          render(width: number): string[] {
            if (instances.length === 0) {
              return [theme.fg("warning", "No managed Quarkus instances are running.")];
            }

            const visibleRows = Math.min(instances.length, maxVisibleRows);
            const firstRow = Math.max(0, Math.min(cursor - Math.floor(visibleRows / 2), instances.length - visibleRows));
            const rows = instances.slice(firstRow, firstRow + visibleRows).map((instance, index) => {
              const actualIndex = firstRow + index;
              const marker = actualIndex === cursor ? ">" : " ";
              const checked = selected.has(instance.projectDir) ? "[x]" : "[ ]";
              const suffix = instance.relativeDir === instance.label
                ? statusText[instance.appState]
                : `${instance.relativeDir} • ${statusText[instance.appState]}`;
              const line = `${marker} ${checked} ${instance.label}  ${suffix}`;
              return truncateToWidth(actualIndex === cursor ? theme.fg("accent", line) : line, width);
            });

            if (instances.length > visibleRows) {
              rows.push(theme.fg("dim", `${firstRow + 1}-${firstRow + visibleRows} of ${instances.length}`));
            }
            return rows;
          },
          invalidate(): void {},
          handleInput(data: string): void {
            if (matchesKey(data, Key.up) && cursor > 0) {
              cursor -= 1;
            } else if (matchesKey(data, Key.down) && cursor < instances.length - 1) {
              cursor += 1;
            } else if (matchesKey(data, Key.space)) {
              const current = instances[cursor];
              if (!current) return;
              selected = new Set(selected);
              if (selected.has(current.projectDir)) selected.delete(current.projectDir);
              else selected.add(current.projectDir);
            } else if (matchesKey(data, Key.enter)) {
              if (selected.size === 0) {
                const current = instances[cursor];
                done(current ? [current.projectDir] : []);
              } else {
                done(Array.from(selected));
              }
              return;
            } else if (matchesKey(data, Key.escape)) {
              done(null);
              return;
            }
            tui.requestRender();
          },
        };

        const container = new Container();
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
        container.addChild(new Text(theme.fg("accent", theme.bold("Stop Quarkus Services")), 1, 0));
        container.addChild(list);
        container.addChild(new Text(
          theme.fg("dim", "↑↓ navigate • space toggle • enter stop selected/current • esc cancel"),
          1, 0,
        ));
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

        return {
          render: (width: number) => container.render(width),
          invalidate: () => container.invalidate(),
          handleInput: (data: string) => { list.handleInput(data); },
        };
      },
      { overlay: true },
    );

    if (!selectedDirs || selectedDirs.length === 0) return null;
    const selectedSet = new Set(selectedDirs);
    return instances.filter((instance) => selectedSet.has(instance.projectDir));
  }

  async function stopInstances(instances: ServiceTarget[], cwd: string, ctx: { ui: CommandUi }): Promise<void> {
    ctx.ui.setStatus("quarkus", `[quarkus stop ${instances.length}…]`);
    const successes: Array<{ instance: ServiceTarget; output: string }> = [];
    const failures: Array<{ instance: ServiceTarget; error: string }> = [];

    for (const instance of instances) {
      try {
        rememberAgentLifecycleChange(instance.projectDir);
        const output = await callMcpTool("quarkus_stop", { projectDir: instance.projectDir }, cwd);
        successes.push({ instance, output });
      } catch (err) {
        failures.push({ instance, error: (err as Error).message });
      }
    }
    ctx.ui.setStatus("quarkus", undefined);

    if (failures.length === 0) {
      if (successes.length === 1) {
        const output = successes[0]?.output ?? "";
        const lines = output.split("\n");
        const preview = lines.slice(0, PREVIEW_LINES).join("\n") + (lines.length > PREVIEW_LINES ? "\n…" : "");
        ctx.ui.notify(preview || `Stopped ${successes[0]?.instance.label ?? "service"}`, "info");
      } else {
        ctx.ui.notify(`Stopped ${successes.map(({ instance }) => instance.label).join(", ")}`, "info");
      }
      return;
    }

    const successSummary = successes.length > 0
      ? `Stopped successfully: ${successes.map(({ instance }) => instance.relativeDir).join(", ")}`
      : "Stopped successfully: none";
    const failureSummary = failures
      .map(({ instance, error }) => `Failed to stop ${instance.relativeDir}:\n${error}`)
      .join("\n\n");

    ctx.ui.notify(`stop failed for ${failures.map(({ instance }) => instance.label).join(", ")} – asking LLM for help…`, "warning");
    handOffFailure("stop", `${successSummary}\n\n${failureSummary}`);
  }

  async function handleStopSubcommand(cwd: string, ctx: { ui: CommandUi; mode: string }, extra?: string): Promise<void> {
    const candidates = runningServiceTargets(await loadServiceTargets(cwd));

    if (extra) {
      const { resolved, missing, ambiguous } = resolveServiceTargets(extra, candidates);
      if (missing.length > 0 || ambiguous.length > 0) {
        const problems = [
          ...missing.map((token) => `Unknown module: ${token}`),
          ...ambiguous.map(({ token, matches }) => `Ambiguous module: ${token} → ${matches.map((match) => match.relativeDir).join(", ")}`),
        ];
        ctx.ui.notify(problems.join("\n"), "error");
        return;
      }
      if (resolved.length === 0) {
        ctx.ui.notify("No matching managed Quarkus services to stop.", "warning");
        return;
      }
      return stopInstances(resolved, cwd, ctx);
    }

    if (candidates.length === 0) {
      ctx.ui.notify("No managed Quarkus services are running.", "warning");
      return;
    }
    if (candidates.length === 1) {
      return stopInstances(candidates, cwd, ctx);
    }
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Multiple Quarkus services are running. Pass module names to /quarkus stop explicitly.", "warning");
      return;
    }

    const selected = await selectInstancesToStop(candidates, ctx);
    if (!selected) return;
    await stopInstances(selected, cwd, ctx);
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

  /** Update the footer status widget with the current app state. */
  async function refreshAppStatus(cwd: string, ctx: { ui: PollingUi }): Promise<void> {
    if (!state.client) return;
    try {
      const text = await callMcpTool("quarkus_list", {}, cwd);
      const instances = parseListOutput(text);
      const serviceStates = new Map(
        mergeServiceStates(cwd, instances).map((service) => [service.projectDir, service.appState] as const),
      );

      ctx.ui.setStatus("quarkus", formatFooterStatus(instances));

      // Enable app-file logging for newly-running instances
      for (const [dir, instanceState] of instances) {
        if (instanceState === "running" && !state.appLogEnabled) {
          state.appLogEnabled = true;
          callMcpTool("quarkus_app_log", { projectDir: dir, action: "enable" }, cwd).catch(() => {});
        }
      }

      if (state.hasObservedStates) {
        for (const [dir, nextState] of serviceStates) {
          const previousState = state.instanceStates.get(dir) ?? "stopped";
          if (nextState === "crashed" && previousState !== "crashed") {
            state.pendingLifecycleChanges.delete(dir);
            await onCrashed(dir);
            continue;
          }
          recordLifecycleChange(dir, previousState, nextState);
        }
      } else {
        state.hasObservedStates = true;
      }

      state.instanceStates = serviceStates;
    } catch {
      // MCP error — clear rather than show stale state
      ctx.ui.setStatus("quarkus", undefined);
    }
  }

  // -------------------------------------------------------------------------
  // /quarkus command — subcommand handlers
  // -------------------------------------------------------------------------

  const DIRECT_SUBCOMMANDS = ["status", "start", "stop", "logs", "restart", "open", "devui", "list", "agent-log"] as const;
  const LLM_SUBCOMMANDS    = ["update", "search-tools"] as const;
  const TEST_SUBCOMMANDS   = ["test-affected", "test-all"] as const;
  const ALL_SUBCOMMANDS    = [...DIRECT_SUBCOMMANDS, ...LLM_SUBCOMMANDS, ...TEST_SUBCOMMANDS, "info", "skills", "mcp-restart", "mcp-tools"] as const;

  type Subcommand = (typeof ALL_SUBCOMMANDS)[number];

  /**
   * Every MCP tool name this extension calls directly.
   * If any are absent from the server's tool list at startup, the user is warned.
   * Keep in sync with TOOL_NAME values and any direct callMcpTool() calls.
   */
  const REQUIRED_TOOLS: readonly string[] = [
    // subcommand-mapped tools (all distinct values from TOOL_NAME)
    "quarkus_status",
    "quarkus_start",
    "quarkus_stop",
    "quarkus_logs",
    "quarkus_browser",
    "quarkus_restart",
    "quarkus_skills",
    "quarkus_searchTools",
    "quarkus_callTool",
    "quarkus_list",
    "quarkus_agent_log",
    "quarkus_updateSkill",
    "quarkus_saveSkill",
    // called directly (not via TOOL_NAME)
    "quarkus_app_log",
    "quarkus_installSkills",
  ];

  /** Map user-facing subcommand → MCP tool name. */
  const TOOL_NAME: Record<string, string> = {
    status:  "quarkus_status",
    start:   "quarkus_start",
    stop:    "quarkus_stop",
    logs:    "quarkus_logs",
    open:    "quarkus_browser",
    devui:   "quarkus_browser",
    restart: "quarkus_restart",
    list:        "quarkus_list",
    "agent-log": "quarkus_agent_log",
    update:  "quarkus_skills",
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
    if (sub === "open") {
      return { projectDir: cwd, target: "app" };
    }
    if (sub === "devui") {
      return { projectDir: cwd, target: "devui" };
    }
    if (sub === "update") {
      return { projectDir: cwd, query: "quarkus-update" };
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
  const INSTANCE_SCOPED_DIRECT_SUBCOMMANDS = new Set(["logs", "restart", "open", "devui"]);

  async function handleInfo(cwd: string, ctx: { ui: CommandUi; mode: string }, extra?: string): Promise<void> {
    const services = await loadServiceTargets(cwd);
    const target = await chooseServiceTarget("info", cwd, ctx, extra, services);
    if (target === null) return;
    const project = target?.projectDir ?? cwd;
    const running = await ensureDevMode(project, ctx);
    if (!running) return;
    ctx.ui.setStatus("quarkus", "[quarkus info…]");
    const [statusRes, endpointsRes, devServicesRes] = await Promise.allSettled([
      callMcpTool("quarkus_status", { projectDir: project }, cwd),
      callMcpTool("quarkus_callTool", { projectDir: project, toolName: "devui-endpoints_getAllEndpoints" }, cwd),
      callMcpTool("quarkus_callTool", { projectDir: project, toolName: "devui-dev-services_getDevServices" }, cwd),
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

/** Absolute path to the directory where community skills are installed. */
  const SKILLS_DIR = join(homedir(), ".quarkus", "skills");

  async function handleSkills(cwd: string, ctx: { ui: CommandUi }): Promise<void> {
    ctx.ui.setStatus("quarkus", "[quarkus loading skills…]");

    // Fetch installed and available skills in parallel
    const [installedResult, availableResult] = await Promise.allSettled([
      callMcpTool("quarkus_skills", { projectDir: cwd }, cwd),
      callMcpTool("quarkus_installSkills", { projectDir: cwd, list: "true" }, cwd),
    ]);
    ctx.ui.setStatus("quarkus", undefined);

    // Parse installed skill names from quarkus_skills output
    const installedRaw = installedResult.status === "fulfilled" ? installedResult.value : "";
    const installedNames: string[] = installedRaw
      .split("\n")
      .map((l) => l.match(/^[-*]\s+\*{0,2}([\w-]+)\*{0,2}/)?.[1] ?? "")
      .filter((n) => n.length > 0);

    // Parse available skill names from quarkus_installSkills list output
    const availableRaw = availableResult.status === "fulfilled" ? availableResult.value : "";
    const availableNames: string[] = availableRaw
      .split("\n")
      .map((l) => l.match(/^[-*]\s+\*{0,2}([\w-]+)\*{0,2}/)?.[1] ?? "")
      .filter((n) => n.length > 0 && !installedNames.includes(n));

    // --- Screen 1: installed skills (with delete option) ---
    if (installedNames.length > 0) {
      const deleteItems = [
        ...installedNames.map((n) => ({ value: n, label: n, description: "[d] delete" })),
        { value: "__browse__", label: "Browse available skills…", description: "install from community" },
      ];

      const chosen = await ctx.ui.custom<string | null>(
        (tui, theme, _kb, done) => {
          const TuiText = Text;
          const container = new Container();
          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
          container.addChild(new TuiText(theme.fg("accent", theme.bold("Installed Skills")), 1, 0));
          const list = new SelectList(deleteItems, Math.min(deleteItems.length + 2, 15), {
            selectedPrefix: (t: string) => theme.fg("accent", t),
            selectedText:   (t: string) => theme.fg("accent", t),
            description:    (t: string) => theme.fg("muted",  t),
            scrollInfo:     (t: string) => theme.fg("dim",    t),
            noMatch:        (t: string) => theme.fg("warning", t),
          });
          list.onSelect = (item: { value: string }) => done(item.value);
          list.onCancel = () => done(null);
          container.addChild(list);
          container.addChild(new TuiText(
            theme.fg("dim", "↑↓ navigate • enter select / browse • esc cancel"),
            1, 0,
          ));
          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
          return {
            render:      (w: number) => container.render(w),
            invalidate:  ()          => container.invalidate(),
            handleInput: (data: string) => { list.handleInput(data); tui.requestRender(); },
          };
        },
        { overlay: true },
      );

      if (chosen === null) return;

      if (chosen !== "__browse__") {
        // Delete the chosen skill
        const skillPath = join(SKILLS_DIR, chosen);
        try {
          rmSync(skillPath, { recursive: true, force: true });
        } catch (err) {
          ctx.ui.notify(`Failed to delete skill "${chosen}": ${(err as Error).message}`, "error");
          return;
        }
        ctx.ui.notify(`Skill "${chosen}" deleted.`, "info");
        pi.sendUserMessage(
          `The community skill "${chosen}" has been deleted from ${skillPath}. It is no longer available via quarkus_skills.`,
          { deliverAs: "followUp" },
        );
        return;
      }
    }

    // --- Screen 2: available skills to install ---
    if (availableNames.length === 0) {
      ctx.ui.notify("No additional community skills available.", "info");
      return;
    }

    const installItems = availableNames.map((n) => ({ value: n, label: n }));
    const chosen = await ctx.ui.custom<string | null>(
      (tui, theme, _kb, done) => {
        const TuiText = Text;
        const container = new Container();
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
        container.addChild(new TuiText(theme.fg("accent", theme.bold("Available Skills")), 1, 0));
        const list = new SelectList(installItems, Math.min(installItems.length + 2, 15), {
          selectedPrefix: (t: string) => theme.fg("accent", t),
          selectedText:   (t: string) => theme.fg("accent", t),
          scrollInfo:     (t: string) => theme.fg("dim",    t),
          noMatch:        (t: string) => theme.fg("warning", t),
        });
        list.onSelect = (item: { value: string }) => done(item.value);
        list.onCancel = () => done(null);
        container.addChild(list);
        container.addChild(new TuiText(
          theme.fg("dim", "↑↓ navigate • type to filter • enter install • esc cancel"),
          1, 0,
        ));
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
        return {
          render:      (w: number) => container.render(w),
          invalidate:  ()          => container.invalidate(),
          handleInput: (data: string) => { list.handleInput(data); tui.requestRender(); },
        };
      },
      { overlay: true },
    );

    if (!chosen) return;

    ctx.ui.setStatus("quarkus", `[quarkus installing ${chosen}…]`);
    try {
      await callMcpTool("quarkus_installSkills", { projectDir: cwd, skillName: chosen }, cwd);
      ctx.ui.setStatus("quarkus", undefined);
      ctx.ui.notify(`Skill "${chosen}" installed.`, "info");
      pi.sendUserMessage(
        `The community skill "${chosen}" has been installed to ${SKILLS_DIR}. It is now available via quarkus_skills.`,
        { deliverAs: "followUp" },
      );
    } catch (err) {
      ctx.ui.setStatus("quarkus", undefined);
      ctx.ui.notify(`Failed to install "${chosen}": ${(err as Error).message}`, "error");
    }
  }

  async function handleMcpRestart(cwd: string, ctx: { ui: CommandUi }): Promise<void> {
    if (state.client) {
      await state.client.close().catch(() => {});
      state.client = null;
      state.pendingStart = null;
    }
    ctx.ui.setStatus("quarkus", "[quarkus restarting with --fresh…]");
    try {
      // Pass --fresh so jbang re-downloads the latest quarkus-agent-mcp jar
      // instead of serving whatever is in its local cache.
      const c = await startClient(cwd, true);
      state.client = c;
      registerMcpTools(c.tools, cwd);
      ctx.ui.setStatus("quarkus", undefined);
      ctx.ui.notify(`quarkus restarted: ${c.tools.length} tools`, "info");
    } catch (err) {
      ctx.ui.setStatus("quarkus", undefined);
      if (err instanceof JbangMissingError) {
        await handleJbangMissing(cwd, ctx);
      } else {
        ctx.ui.notify(`quarkus restart failed: ${(err as Error).message}`, "error");
      }
    }
  }

  async function handleSelector(ctx: { ui: CommandUi }): Promise<void> {
    const LABELS: Record<string, string> = {
      status:          "status        - Show all discovered app states",
      start:           "start         - Start a discovered app in dev mode",
      stop:            "stop          - Stop one or more managed apps",
      logs:            "logs          - Show recent log output",
      restart:         "restart       - Restart the app (hot reload)",
      open:            "open          - Open the app in the browser",
      devui:           "devui         - Open the Dev UI in the browser",
      list:            "list          - List all managed Quarkus instances",
      "agent-log":     "agent-log     - Read the MCP server's own log file",
      update:          "update           - Check for Quarkus updates (LLM)",
      "search-tools":  "search-tools     - Discover Dev MCP tools on the running app (LLM)",
      "test-affected": "test-affected    - Run affected tests (LLM)",
      "test-all":      "test-all         - Run full test suite (LLM)",
      info:            "info          - Show app status, endpoints, and dev services",
      skills:          "skills        - Manage installed community skills",
      "mcp-restart":   "mcp-restart   - Restart the quarkus-agent-mcp server",
      "mcp-tools":     "mcp-tools     - List all tools advertised by the MCP server",
    };
    const labels = ALL_SUBCOMMANDS.map((s) => LABELS[s]);
    const chosen = await ctx.ui.select("Quarkus action", labels);
    if (!chosen) return;
    const chosenSub = chosen.split(" ")[0] as Subcommand;
    pi.sendUserMessage(`/quarkus ${chosenSub}`, { deliverAs: "followUp" });
  }

  async function handleTestSubcommand(sub: string, cwd: string, ctx: { ui: CommandUi; mode: string }, extra?: string): Promise<void> {
    const services = await loadServiceTargets(cwd);
    const target = await chooseServiceTarget(sub, cwd, ctx, extra, services);
    if (target === null) return;
    const project = target?.projectDir ?? cwd;
    const running = await ensureDevMode(project, ctx);
    if (!running) return;
    const devuiTool = sub === "test-all"
      ? "devui-testing_runTests"
      : "devui-testing_runAffectedTests";
    ctx.ui.setStatus("quarkus", `[quarkus ${sub}…]`);
    let testOutput: string;
    let testFailed = false;
    try {
      testOutput = await callMcpTool("quarkus_callTool", { projectDir: project, toolName: devuiTool }, cwd);
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

  async function handleLlmSubcommand(sub: string, extra: string | undefined, cwd: string, ctx: { ui: CommandUi; mode: string }): Promise<void> {
    const toolName = TOOL_NAME[sub];
    if (!toolName) {
      ctx.ui.notify(`Unknown subcommand: ${sub}`, "error");
      return;
    }
    let project = cwd;
    if (sub === "search-tools") {
      const services = await loadServiceTargets(cwd);
      const target = await chooseServiceTarget(sub, cwd, ctx, undefined, services);
      if (target === null) return;
      project = target?.projectDir ?? cwd;
    }
    if (REQUIRES_DEV_MODE.has(sub)) {
      const running = await ensureDevMode(project, ctx);
      if (!running) return;
    }
    ctx.ui.setStatus("quarkus", `[quarkus ${sub}…]`);
    try {
      const output = await callMcpTool(toolName, buildArgs(sub, project, extra), cwd);
      ctx.ui.setStatus("quarkus", undefined);
      handOffSuccess(sub, output);
    } catch (err) {
      ctx.ui.setStatus("quarkus", undefined);
      handOffFailure(sub, (err as Error).message);
    }
  }

  async function handleDirectSubcommand(sub: string, cwd: string, ctx: { ui: CommandUi; mode: string }, extra?: string): Promise<void> {
    const toolName = TOOL_NAME[sub];
    if (!toolName) {
      ctx.ui.notify(`Unknown subcommand: ${sub}`, "error");
      return;
    }
    let project = cwd;
    if (INSTANCE_SCOPED_DIRECT_SUBCOMMANDS.has(sub)) {
      const services = await loadServiceTargets(cwd);
      const target = await chooseServiceTarget(sub, cwd, ctx, extra, services);
      if (target === null) return;
      project = target?.projectDir ?? cwd;
      extra = undefined;
    }
    if (REQUIRES_DEV_MODE.has(sub)) {
      const running = await ensureDevMode(project, ctx);
      if (!running) return;
    }
    ctx.ui.setStatus("quarkus", `[quarkus ${sub}…]`);
    try {
      if (sub === "restart") rememberAgentLifecycleChange(project);
      const output = await callMcpTool(toolName, buildArgs(sub, project, extra), cwd);
      ctx.ui.setStatus("quarkus", undefined);
      if (sub === "start") {
        // quarkus_start blocks until RUNNING or CRASHED — show startup log as a rich message
        const outcome = output.includes("running") ? "running" : "crashed";
        pi.sendMessage(
          { customType: QUARKUS_STARTUP_LOG_MSG_TYPE, content: "", display: true, details: { log: output, outcome } },
          { triggerTurn: false },
        );
      } else {
        // Show first PREVIEW_LINES lines as a notification, rest is available on demand
        const lines = output.split("\n");
        const preview = lines.slice(0, PREVIEW_LINES).join("\n") + (lines.length > PREVIEW_LINES ? "\n…" : "");
        ctx.ui.notify(preview || `${sub} OK`, "info");
      }
    } catch (err) {
      ctx.ui.setStatus("quarkus", undefined);
      const errMsg = (err as Error).message;
      ctx.ui.notify(`${sub} failed – asking LLM for help…`, "warning");
      handOffFailure(sub, errMsg);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers: jbang-missing interactive install
  // -------------------------------------------------------------------------

  async function handleJbangMissing(cwd: string, ctx: { ui: CommandUi }): Promise<void> {
    const options = jbangInstallOptions();
    if (options.length === 0) {
      ctx.ui.notify(
        "jbang is not installed. Install it from https://www.jbang.dev/download/ and restart pi.",
        "warning",
      );
      return;
    }
    const selectItems = [
      ...options.map((o) => ({ value: o.label, label: o.label, description: o.description })),
      { value: "__later__", label: "Later", description: "I'll install jbang myself" },
    ];

    const chosen = await ctx.ui.select(
      "⚠ jbang is not installed — choose how to install it:",
      selectItems.map((i) => `${i.label}  ${i.description}`),
    );
    if (!chosen || chosen.startsWith("Later")) return;

    const option = options.find((o) => chosen.startsWith(o.label));
    if (!option) return;

    ctx.ui.setStatus("quarkus", `[quarkus installing jbang via ${option.label}…]`);
    let installOutput = "";
    try {
      ({ output: installOutput } = await option.install());
    } catch (err) {
      ctx.ui.setStatus("quarkus", undefined);
      ctx.ui.notify(`jbang install failed: ${(err as Error).message}`, "error");
      return;
    }

    // Verify jbang is now on PATH
    if (!jbangBin()) {
      ctx.ui.setStatus("quarkus", undefined);
      ctx.ui.notify(
        `jbang installed but not found on PATH.\nInstaller output:\n${installOutput || "(none)"}`,
        "warning",
      );
      return;
    }

    ctx.ui.notify("jbang installed. Starting Quarkus MCP…", "info");
    ctx.ui.setStatus("quarkus", "[quarkus starting…]");
    try {
      const c = await ensureClient(cwd);
      ctx.ui.setStatus("quarkus", undefined);
      ctx.ui.notify(`quarkus: ${c.tools.length} tools loaded`, "info");
      if (state.statusPoller) clearInterval(state.statusPoller);
      state.statusPoller = setInterval(() => { refreshAppStatus(cwd, ctx).catch(() => {}); }, 5_000);
      refreshAppStatus(cwd, ctx).catch(() => {});
    } catch (err) {
      ctx.ui.setStatus("quarkus", undefined);
      ctx.ui.notify(`quarkus failed to start: ${(err as Error).message}`, "error");
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  pi.on("tool_call", async (event) => {
    if (event.toolName === "quarkus_start" || event.toolName === "quarkus_stop" || event.toolName === "quarkus_restart") {
      const project = typeof (event.input as { projectDir?: unknown }).projectDir === "string"
        ? (event.input as { projectDir: string }).projectDir
        : undefined;
      if (project) rememberAgentLifecycleChange(project);
    }
  });

  pi.on("before_agent_start", async (event) => {
    const alreadyLoaded = event.systemPromptOptions.skills?.some(
      (s) => s.name === "quarkus",
    );
    if (alreadyLoaded) return;
    if (!isQuarkusProject(event.systemPromptOptions.cwd ?? "")) return;
    return {
      systemPrompt: event.systemPrompt + "\n\nA Quarkus project was detected (quarkus-maven-plugin present). Load the `quarkus` skill before proceeding.",
    };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const lifecycleSummary = drainLifecycleSummary(ctx.cwd);
    if (!lifecycleSummary) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\nContext update: Quarkus service state changed since the last turn: ${lifecycleSummary}.`,
    };
  });

  pi.on("session_start", (_event, ctx) => {
    const cwd = projectDir(ctx);

    if (!isQuarkusProject(cwd)) return;

    ctx.ui.setStatus("quarkus", "[quarkus starting…]");
    // Start the MCP server in the background so it doesn't block session startup.
    ensureClient(cwd)
      .then((c) => {
        ctx.ui.setStatus("quarkus", undefined);
        const availableNames = new Set(c.tools.map((t) => t.name));
        const missingTools = REQUIRED_TOOLS.filter((t) => !availableNames.has(t));
        if (missingTools.length > 0) {
          ctx.ui.notify(
            `quarkus: MCP server is missing expected tools: ${missingTools.join(", ")}. The jbang cache may be stale — run /quarkus mcp-restart to evict it and reload the latest version.`,

            "warning",
          );
        }
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
        if (err instanceof JbangMissingError) {
          handleJbangMissing(cwd, ctx).catch(() => {});
        } else {
          ctx.ui.notify(`quarkus: failed to start – ${(err as Error).message}`, "error");
        }
      });
  });

  pi.on("session_shutdown", async () => {
    if (state.statusPoller) { clearInterval(state.statusPoller); state.statusPoller = null; }
    if (state.client) {
      await state.client.close().catch(() => {});
      state.client = null;
      state.pendingStart = null;
    }
    state.instanceStates.clear();
    state.pendingLifecycleChanges.clear();
    state.suppressedLifecycleChanges.clear();
    state.hasObservedStates = false;
    state.appLogEnabled = false;
  });

  // Keep display-only custom messages out of the LLM context.
  // QUARKUS_TEST_MSG_TYPE is intentionally excluded: its content IS the LLM prompt.
  pi.on("context", async (event) =>
    filterDisplayOnlyMessages(event, QUARKUS_INFO_MSG_TYPE, QUARKUS_STARTUP_LOG_MSG_TYPE),
  );

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
              status:          "Show all discovered app states",
              start:           "Start a discovered app in dev mode",
              stop:            "Stop one or more managed apps",
              logs:            "Show recent log output",
              restart:         "Restart the app (hot reload)",
              open:            "Open the app in the browser",
              devui:           "Open the Dev UI in the browser",
              list:            "List all managed Quarkus instances",
              "agent-log":     "Read the MCP server's own log file",
              update:          "Check for Quarkus updates (analysed by LLM)",
              "search-tools":  "Discover Dev MCP tools on the running app (analysed by LLM)",
              "test-affected": "Run tests affected by recent changes (results analysed by LLM)",
              "test-all":      "Run the full test suite (results analysed by LLM)",
              info:            "Show app status, endpoints, and dev services",
              skills:          "Manage installed community skills",
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

      if (sub === "info")        return handleInfo(cwd, ctx, extra);
      if (sub === "skills")      return handleSkills(cwd, ctx);
      if (sub === "mcp-tools")   return handleMcpTools(ctx);
      if (sub === "mcp-restart") return handleMcpRestart(cwd, ctx);
      if (!sub)                   return handleSelector(ctx);

      // Ensure the MCP server is running before any tool call
      if (!state.client) {
        if (!isQuarkusProject(cwd)) {
          const ok = await ctx.ui.confirm(
            "Not a Quarkus project",
            "No Quarkus build file detected. Start quarkus-agent-mcp anyway?",
          );
          if (!ok) return;
        }
        ctx.ui.setStatus("quarkus", "[quarkus starting…]");
        try {
          await ensureClient(cwd);
          ctx.ui.setStatus("quarkus", undefined);
        } catch (err) {
          ctx.ui.setStatus("quarkus", undefined);
          if (err instanceof JbangMissingError) {
            await handleJbangMissing(cwd, ctx);
          } else {
            ctx.ui.notify(`quarkus failed to start: ${(err as Error).message}`, "error");
          }
          return;
        }
      }

      if (sub === "status")                                          return handleStatusSubcommand(cwd, ctx, extra);
      if (sub === "start")                                           return handleStartSubcommand(cwd, ctx, extra);
      if (sub === "stop")                                            return handleStopSubcommand(cwd, ctx, extra);
      if ((TEST_SUBCOMMANDS    as readonly string[]).includes(sub))   return handleTestSubcommand(sub, cwd, ctx, extra);
      if ((LLM_SUBCOMMANDS     as readonly string[]).includes(sub))   return handleLlmSubcommand(sub, extra, cwd, ctx);
      if ((DIRECT_SUBCOMMANDS  as readonly string[]).includes(sub))   return handleDirectSubcommand(sub, cwd, ctx, extra);

      ctx.ui.notify(
        `Unknown subcommand: "${sub}". Try: ${ALL_SUBCOMMANDS.join(", ")}`,
        "error",
      );
    },
  });
}
