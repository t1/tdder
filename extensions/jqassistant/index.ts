/**
 * jQAssistant pi Extension
 *
 * Provides /jqa commands and LLM tools to scan, query, analyze, and explore
 * rules against the embedded Neo4j store that jQAssistant manages.
 *
 * Commands (user):
 *   /jqa scan            – Scan the current project into the Neo4j store
 *   /jqa query <cypher>  – Run a Cypher query and display results
 *   /jqa analyze         – Run rules/constraints (requires jqassistant/rules/)
 *   /jqa explore         – Interactive rules explorer
 *   /jqa reset           – Wipe the store (with confirmation)
 *   /jqa start           – Start the embedded Neo4j server
 *   /jqa stop            – Stop the embedded Neo4j server
 *   /jqa status          – Show server status
 *
 * Tools (LLM):
 *   jqa_query            – Run a Cypher query; auto-starts server
 *   jqa_analyze          – Run analyze; auto-starts server
 *   jqa_list_rules       – List all available concepts, constraints, groups
 *   jqa_apply_concept    – Apply a concept by ID; auto-starts server
 *   jqa_run_constraint   – Run a constraint by ID; auto-starts server
 *   jqa_add_rule_to_config – Add a rule reference to .jqassistant.yml
 *
 * Staleness tracking:
 *   - At session start: walk target/classes + target/test-classes across all
 *     modules; if any .class file is newer than the sentinel file
 *     (target/.jqa-scan-timestamp), mark the store stale.
 *   - During the session: fs.watch on target/classes + target/test-classes
 *     directories (two-level: watch module root when target/ doesn't exist yet,
 *     promote to classes watcher when it appears, demote on deletion).
 *   - After a successful scan: write the sentinel file.
 *   - /jqa scan always checks staleness and skips if fresh.
 *     Use sub-command "scan --force" to override.
 *   - The LLM tools (jqa_query, jqa_analyze, etc.) auto-scan before executing
 *     when the store is stale — no explicit scan tool is exposed to the LLM.
 *
 * Note: jQAssistant's embedded HTTP port (7474) serves only the browser UI.
 * Queries are sent over Bolt (7687) using the neo4j-driver package.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, Spacer, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SelectItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { createRequire } from "node:module";
import { ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, statSync, readdirSync, watchFile, unwatchFile } from "node:fs";
import { watch as fsWatch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { join, extname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const neo4j = require("neo4j-driver") as any;

// ─── Rule model ─────────────────────────────────────────────────────────────

interface Rule {
  id: string;
  kind: "concept" | "constraint" | "group";
  description: string;
  cypher?: string;
  requiresConcepts: string[];
  includesGroups?: string[];
  includesConstraints?: string[];
}

interface RuleSet {
  concepts: Map<string, Rule>;
  constraints: Map<string, Rule>;
  groups: Map<string, Rule>;
}

// ─── Server state ───────────────────────────────────────────────────────────

interface ServerState {
  process: ChildProcess | null;
  boltPort: number;
  httpPort: number;
  ready: boolean;
  startPromise: Promise<void> | null;
}

// ─── Watcher state ──────────────────────────────────────────────────────────

type WatcherMode = "parent" | "classes";

interface ModuleWatcher {
  moduleDir: string;        // e.g. /abs/path/to/demo/order
  mode: WatcherMode;
  watcher: FSWatcher | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_HTTP_PORT = 7474;
const DEFAULT_BOLT_PORT = 7687;
const SERVER_STARTUP_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;
const JQA_BIN = "jqassistant";
const M2_REPO = join(homedir(), ".m2", "repository");
const SENTINEL_FILENAME = ".jqa-scan-timestamp";

/** Modules to watch, relative to cwd. */
const WATCHED_MODULES = [".", "lib", "junit", "mock", "demo/order", "demo/product"];

// ─── Rule loading ────────────────────────────────────────────────────────────

function discoverActivePlugins(cwd: string): { plugins: string[]; version: string } {
  let output = "";
  try {
    output = execSync(`${JQA_BIN} available-rules 2>&1`, { cwd, env: process.env, timeout: 30_000 }).toString();
  } catch (e: any) {
    output = e.stdout?.toString() ?? "";
  }

  const pluginRe = /\[jqa\.plugin\.([^\]]+)\]/g;
  const versionRe = /PluginRepositoryImpl.*Plugin (\d+\.\d+\.\d+)/;

  const plugins: string[] = [];
  let version = "2.9.1";

  for (const line of output.split("\n")) {
    if (!line.includes("PluginRepositoryImpl")) continue;
    const vm = line.match(versionRe);
    if (vm) version = vm[1];
    let m: RegExpExecArray | null;
    while ((m = pluginRe.exec(line)) !== null) {
      if (!plugins.includes(m[1])) plugins.push(m[1]);
    }
    pluginRe.lastIndex = 0;
  }

  return { plugins, version };
}

function pluginJarPath(artifactId: string, version: string): string {
  return join(M2_REPO, "com", "buschmais", "jqassistant", "plugin",
    artifactId, version, `${artifactId}-${version}.jar`);
}

function parseRulesFromJar(jarPath: string): Rule[] {
  if (!existsSync(jarPath)) return [];

  let listing = "";
  try {
    listing = execSync(`unzip -l "${jarPath}"`, { timeout: 10_000 }).toString();
  } catch { return []; }

  const xmlFiles = listing.split("\n")
    .map(l => l.trim())
    .filter(l => l.includes("META-INF/jqassistant-rules/") && l.endsWith(".xml"))
    .map(l => { const parts = l.split(/\s+/); return parts[parts.length - 1]; });

  const rules: Rule[] = [];
  for (const xmlFile of xmlFiles) {
    let xml = "";
    try {
      xml = execSync(`unzip -p "${jarPath}" "${xmlFile}"`, { timeout: 10_000 }).toString();
    } catch { continue; }
    rules.push(...parseRulesXml(xml));
  }
  return rules;
}

function parseRulesXml(xml: string): Rule[] {
  const rules: Rule[] = [];

  const parseBlock = (kind: "concept" | "constraint" | "group", block: string): Rule | null => {
    const idMatch = block.match(/\bid="([^"]+)"/);
    if (!idMatch) return null;
    const id = idMatch[1];

    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/);
    const description = descMatch ? descMatch[1].replace(/\s+/g, " ").trim() : "";

    const cypherMatch = block.match(/<cypher[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/cypher>/);
    const cypher = cypherMatch ? cypherMatch[1].trim() : undefined;

    const requiresConcepts: string[] = [];
    const reqRe = /<requiresConcept\b[^>]*\brefId="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = reqRe.exec(block)) !== null) requiresConcepts.push(m[1]);

    const includesGroups: string[] = [];
    const igRe = /<includesGroup\b[^>]*\brefId="([^"]+)"/g;
    while ((m = igRe.exec(block)) !== null) includesGroups.push(m[1]);

    const includesConstraints: string[] = [];
    const icRe = /<includesConstraint\b[^>]*\brefId="([^"]+)"/g;
    while ((m = icRe.exec(block)) !== null) includesConstraints.push(m[1]);

    return { id, kind, description, cypher, requiresConcepts, includesGroups, includesConstraints };
  };

  for (const [tag, kind] of [["concept", "concept"], ["constraint", "constraint"], ["group", "group"]] as const) {
    const blockRe = new RegExp(`<${tag}\\b([\\s\\S]*?)<\\/${tag}>`, "g");
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(xml)) !== null) {
      const rule = parseBlock(kind, m[0]);
      if (rule) rules.push(rule);
    }
  }

  return rules;
}

function loadAllRules(cwd: string): RuleSet {
  const { plugins, version } = discoverActivePlugins(cwd);
  const ruleset: RuleSet = {
    concepts: new Map(),
    constraints: new Map(),
    groups: new Map(),
  };

  for (const plugin of plugins) {
    const jarPath = pluginJarPath(plugin, version);
    const rules = parseRulesFromJar(jarPath);
    for (const rule of rules) {
      if (rule.kind === "concept") ruleset.concepts.set(rule.id, rule);
      else if (rule.kind === "constraint") ruleset.constraints.set(rule.id, rule);
      else if (rule.kind === "group") ruleset.groups.set(rule.id, rule);
    }
  }

  return ruleset;
}

function resolveConceptChain(constraintOrConcept: Rule, concepts: Map<string, Rule>): Rule[] {
  const visited = new Set<string>();
  const ordered: Rule[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const concept = concepts.get(id);
    if (!concept) return;
    for (const dep of concept.requiresConcepts) visit(dep);
    ordered.push(concept);
  }

  for (const dep of constraintOrConcept.requiresConcepts) visit(dep);
  return ordered;
}

// ─── Staleness helpers ───────────────────────────────────────────────────────

/** Absolute path of the sentinel file (in the root target/ dir). */
function sentinelPath(cwd: string): string {
  return join(cwd, "target", SENTINEL_FILENAME);
}

/** Write the sentinel file, recording the time of a successful scan. */
function writeSentinel(cwd: string): void {
  const p = sentinelPath(cwd);
  try {
    // Ensure target/ exists (it always should after a scan, but be safe)
    const targetDir = join(cwd, "target");
    if (!existsSync(targetDir)) return;
    writeFileSync(p, new Date().toISOString() + "\n");
  } catch { /* ignore */ }
}

/**
 * Read the sentinel mtime. Returns 0 if the sentinel doesn't exist,
 * meaning the store is definitely stale.
 */
function sentinelMtime(cwd: string): number {
  try { return statSync(sentinelPath(cwd)).mtimeMs; } catch { return 0; }
}

/**
 * Walk a directory recursively, calling `visitor` for each file.
 * Returns true (early-exit signal) if `visitor` returns true.
 */
function walkFiles(dir: string, visitor: (filePath: string) => boolean): boolean {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return false; }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      if (walkFiles(full, visitor)) return true;
    } else {
      if (visitor(full)) return true;
    }
  }
  return false;
}

/**
 * Check whether the jQAssistant store is stale relative to compiled classes.
 * Uses early-exit: stops as soon as any .class file newer than the sentinel is found.
 */
function isStoreStale(cwd: string): boolean {
  const threshold = sentinelMtime(cwd);
  if (threshold === 0) return true; // no sentinel → always stale

  for (const mod of WATCHED_MODULES) {
    for (const scope of ["classes", "test-classes"]) {
      const dir = join(cwd, mod, "target", scope);
      if (!existsSync(dir)) continue;
      const foundNewer = walkFiles(dir, (filePath) => {
        if (extname(filePath) !== ".class") return false;
        try { return statSync(filePath).mtimeMs > threshold; } catch { return false; }
      });
      if (foundNewer) return true;
    }
  }
  return false;
}

// ─── Extension ──────────────────────────────────────────────────────────────

export default function jqaExtension(pi: ExtensionAPI) {

  // ── Pre-flight state ─────────────────────────────────────────────────────

  let preflightHasConfig = false;
  let storeIsStale = true;
  let extensionCwd = "";

  const server: ServerState = {
    process: null,
    boltPort: DEFAULT_BOLT_PORT,
    httpPort: DEFAULT_HTTP_PORT,
    ready: false,
    startPromise: null,
  };

  // ── Watcher management ───────────────────────────────────────────────────

  const moduleWatchers: ModuleWatcher[] = [];

  function onClassesChanged(): void {
    storeIsStale = true;
  }

  function watchClassesDir(mw: ModuleWatcher, dir: string): void {
    try {
      mw.watcher = fsWatch(dir, { recursive: true }, (event, filename) => {
        if (filename && filename.endsWith(".class")) {
          storeIsStale = true;
        }
      });
      mw.mode = "classes";
      mw.watcher.on("error", () => {
        // Directory probably deleted — fall back to parent watcher
        mw.watcher?.close();
        watchParentDir(mw);
      });
    } catch {
      watchParentDir(mw);
    }
  }

  function watchParentDir(mw: ModuleWatcher): void {
    mw.watcher?.close();
    mw.watcher = null;
    mw.mode = "parent";

    if (!existsSync(mw.moduleDir)) return; // module itself doesn't exist

    try {
      mw.watcher = fsWatch(mw.moduleDir, (event, filename) => {
        if (!filename) return;
        // Promote to classes watcher when target/classes appears
        const classesDir = join(mw.moduleDir, "target", "classes");
        const testClassesDir = join(mw.moduleDir, "target", "test-classes");
        if (existsSync(classesDir) || existsSync(testClassesDir)) {
          mw.watcher?.close();
          // Watch both scopes; use classes dir as the primary
          const dir = existsSync(classesDir) ? classesDir : testClassesDir;
          watchClassesDir(mw, dir);
        }
      });
      mw.watcher.on("error", () => { /* ignore */ });
    } catch { /* ignore */ }
  }

  function setupWatchers(cwd: string): void {
    teardownWatchers();
    for (const mod of WATCHED_MODULES) {
      const moduleDir = join(cwd, mod);
      const mw: ModuleWatcher = { moduleDir, mode: "parent", watcher: null };
      moduleWatchers.push(mw);

      const classesDir = join(moduleDir, "target", "classes");
      const testClassesDir = join(moduleDir, "target", "test-classes");
      if (existsSync(classesDir)) {
        watchClassesDir(mw, classesDir);
      } else if (existsSync(testClassesDir)) {
        watchClassesDir(mw, testClassesDir);
      } else {
        watchParentDir(mw);
      }
    }
  }

  function teardownWatchers(): void {
    for (const mw of moduleWatchers) {
      mw.watcher?.close();
      mw.watcher = null;
    }
    moduleWatchers.length = 0;
  }

  // ── Core helpers ─────────────────────────────────────────────────────────

  async function runJqa(
    task: string,
    extraArgs: string[] = [],
    cwd: string,
    signal?: AbortSignal,
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(JQA_BIN, [task, ...extraArgs], {
        cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
      signal?.addEventListener("abort", () => { child.kill(); reject(new Error("Cancelled")); });
    });
  }

  function stripLogNoise(text: string): string {
    return text.split("\n")
      .filter(line =>
        !/^\d{4}-\d{2}-\d{2}.*\[main\]\s+(INFO|WARN|DEBUG)/.test(line) &&
        !/Downloading|Finished download|ArtifactProvider/.test(line) &&
        !/^WARNING:/.test(line),
      )
      .join("\n").trim();
  }

  async function isBoltReachable(port: number): Promise<boolean> {
    const { createConnection } = await import("node:net");
    return new Promise(resolve => {
      const sock = createConnection(port, "localhost");
      sock.setTimeout(800);
      sock.on("connect", () => { sock.destroy(); resolve(true); });
      sock.on("error", () => resolve(false));
      sock.on("timeout", () => { sock.destroy(); resolve(false); });
    });
  }

  async function runCypher(cypher: string, boltPort: number): Promise<{ columns: string[]; rows: string[][] }> {
    const driver = neo4j.driver(`bolt://localhost:${boltPort}`, neo4j.auth.none());
    const session = driver.session({ database: "neo4j" });
    try {
      const result = await session.run(cypher);
      const columns: string[] = result.records[0]?.keys ?? [];
      const rows: string[][] = result.records.map((rec: any) =>
        columns.map(col => formatCell(rec.get(col))),
      );
      return { columns, rows };
    } finally {
      await session.close();
      await driver.close();
    }
  }

  async function runWriteCypher(cypher: string, boltPort: number): Promise<number> {
    const driver = neo4j.driver(`bolt://localhost:${boltPort}`, neo4j.auth.none());
    const session = driver.session({ database: "neo4j" });
    try {
      const result = await session.run(cypher);
      if (result.records.length > 0) {
        const val = result.records[0].get(result.records[0].keys[0]);
        if (val && typeof val === "object" && "toNumber" in val) return val.toNumber();
      }
      return result.records.length;
    } finally {
      await session.close();
      await driver.close();
    }
  }

  function formatCell(value: unknown): string {
    if (value === null || value === undefined) return "null";
    if (value && typeof value === "object" && "toNumber" in (value as object))
      return String((value as { toNumber(): number }).toNumber());
    if (Array.isArray(value)) return value.map(formatCell).join(" → ");
    if (isNeo4jNode(value)) return formatNode(value as Neo4jNode);
    if (isNeo4jRelationship(value)) return formatRelationship(value as Neo4jRelationship);
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  interface Neo4jNode {
    labels: string[];
    properties: Record<string, unknown>;
  }

  interface Neo4jRelationship {
    type: string;
    properties: Record<string, unknown>;
  }

  function isNeo4jNode(v: unknown): boolean {
    return (
      typeof v === "object" && v !== null &&
      Array.isArray((v as any).labels) &&
      typeof (v as any).properties === "object"
    );
  }

  function isNeo4jRelationship(v: unknown): boolean {
    return (
      typeof v === "object" && v !== null &&
      typeof (v as any).type === "string" &&
      typeof (v as any).properties === "object" &&
      !Array.isArray((v as any).labels)
    );
  }

  function formatNode(node: Neo4jNode): string {
    const props = node.properties;
    const display =
      props["fqn"] ?? props["name"] ?? props["fileName"] ??
      props["signature"] ?? props["value"];
    if (display !== undefined) return String(display);
    const label = node.labels.join(":");
    const entries = Object.entries(props).map(([k, v]) => `${k}: ${v}`).join(", ");
    return entries ? `(${label} {${entries}})` : `(${label})`;
  }

  function formatRelationship(rel: Neo4jRelationship): string {
    const entries = Object.entries(rel.properties).map(([k, v]) => `${k}: ${v}`).join(", ");
    return entries ? `-[:${rel.type} {${entries}}]->` : `-[:${rel.type}]->`;
  }

  function renderTable(columns: string[], rows: string[][]): string {
    if (rows.length === 0) return `(0 rows) [columns: ${columns.join(", ")}]`;
    const widths = columns.map(c => c.length);
    for (const row of rows) row.forEach((cell, i) => { widths[i] = Math.max(widths[i] ?? 0, cell.length); });
    const bar = (l: string, m: string, r: string) => l + widths.map(w => "─".repeat(w + 2)).join(m) + r;
    const line = (cells: string[]) => "│" + cells.map((c, i) => ` ${c.padEnd(widths[i] ?? 0)} `).join("│") + "│";
    return [
      bar("┌", "┬", "┐"), line(columns), bar("├", "┼", "┤"),
      ...rows.map(line), bar("└", "┴", "┘"), `${rows.length} row(s)`,
    ].join("\n");
  }

  async function ensureServer(cwd: string, ctx: UiCtx): Promise<number> {
    if (server.ready && await isBoltReachable(server.boltPort)) return server.boltPort;
    if (server.startPromise) { await server.startPromise; return server.boltPort; }
    server.startPromise = startServer(cwd, ctx);
    try { await server.startPromise; } finally { server.startPromise = null; }
    return server.boltPort;
  }

  async function startServer(cwd: string, ctx: UiCtx): Promise<void> {
    ctx.ui.notify("Starting jQAssistant embedded server…", "info");

    const child = spawn(JQA_BIN, ["server"], {
      cwd, env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    });

    server.process = child;
    server.ready = false;

    child.on("error", err => {
      ctx.ui.notify(`jQAssistant server error: ${err.message}`, "error");
      server.process = null; server.ready = false;
    });
    child.on("close", code => {
      if (server.process !== child) return;
      server.process = null; server.ready = false;
      if (code !== null && code !== 0 && code !== 130)
        ctx.ui.notify(`jQAssistant server exited (code ${code})`, "warning");
    });

    const deadline = Date.now() + SERVER_STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error("jQAssistant server exited prematurely — check store lock or config");
      if (await isBoltReachable(server.boltPort)) {
        server.ready = true;
        ctx.ui.notify(`jQAssistant server ready (bolt::${server.boltPort})`, "info");
        return;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    child.stdin?.destroy(); child.kill(); server.process = null;
    throw new Error(`jQAssistant server did not start within ${SERVER_STARTUP_TIMEOUT_MS / 1000}s`);
  }

  function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

  type UiCtx = {
    ui: {
      notify(msg: string, level: "info" | "warning" | "error"): void;
      setStatus(id: string, msg: string | undefined): void;
    };
  };

  /**
   * Run a scan. Stops the server if running (store lock), scans, writes the
   * sentinel, and clears the stale flag.
   */
  async function performScan(cwd: string, ctx: UiCtx, signal?: AbortSignal): Promise<{ ok: boolean; message: string }> {
    if (server.process && server.ready) {
      ctx.ui.notify("⚠️ Stopping jQAssistant server to release the store lock…", "warning");
      server.process.stdin?.destroy();
      server.process.kill("SIGTERM");
      server.process = null; server.ready = false;
      await sleep(1500);
    }

    ctx.ui.notify("Scanning project with jQAssistant…", "info");
    ctx.ui.setStatus("jqa-scan", "⏳ scanning…");
    try {
      const hasConfig = existsSync(join(cwd, ".jqassistant.yml")) || existsSync(join(cwd, ".jqassistant.yaml"));
      let extraArgs: string[] = [];
      if (!hasConfig) {
        const paths: string[] = [];
        for (const mod of WATCHED_MODULES) {
          for (const scope of ["classes", "test-classes"]) {
            const dir = join(cwd, mod, "target", scope);
            if (existsSync(dir)) paths.push(`java:classpath::${dir}`);
          }
        }
        if (paths.length === 0) {
          return { ok: false, message: "No compiled classes found — run 'mvn compile test-compile' first" };
        }
        extraArgs = ["-f", paths.join(",")];
        ctx.ui.notify(`Scanning ${paths.length} classpaths (no .jqassistant.yml found)`, "info");
      }

      const { stdout, stderr, code } = await runJqa("scan", extraArgs, cwd, signal);
      const out = stripLogNoise(stdout + "\n" + stderr);
      if (code !== 0) {
        return { ok: false, message: `Scan failed (exit ${code})${out ? ": " + out.slice(0, 300) : ""}` };
      }

      writeSentinel(cwd);
      storeIsStale = false;
      return { ok: true, message: "Scan complete" };
    } finally {
      ctx.ui.setStatus("jqa-scan", undefined);
    }
  }

  // ── Rules explorer ───────────────────────────────────────────────────────

  async function applyConcept(concept: Rule, boltPort: number): Promise<string> {
    if (!concept.cypher) return `${concept.id}: no Cypher`;
    const count = await runWriteCypher(concept.cypher, boltPort);
    return `${concept.id}: ${count} affected`;
  }

  async function runConstraint(constraint: Rule, boltPort: number): Promise<{ table: string; violations: number }> {
    if (!constraint.cypher) return { table: "(no Cypher defined)", violations: 0 };
    const { columns, rows } = await runCypher(constraint.cypher, boltPort);
    return { table: renderTable(columns, rows), violations: rows.length };
  }

  async function showRulesExplorer(cwd: string, ctx: any): Promise<void> {
    ctx.ui.setStatus("jqa-rules", "⏳ loading rules…");
    let ruleset: RuleSet;
    try {
      ruleset = loadAllRules(cwd);
    } finally {
      ctx.ui.setStatus("jqa-rules", undefined);
    }

    const { concepts, constraints, groups } = ruleset;
    const totalConcepts = concepts.size;

    if (constraints.size === 0 && groups.size === 0) {
      ctx.ui.notify("No rules found — are the plugin JARs in ~/.m2?", "warning");
      return;
    }

    let conceptsExpanded = false;

    const buildItems = (): SelectItem[] => {
      const items: SelectItem[] = [];

      if (groups.size > 0) {
        items.push({ value: "__header_groups__", label: `── Groups (${groups.size}) ──`, description: "named sets of rules" });
        for (const g of groups.values()) {
          items.push({ value: `group:${g.id}`, label: g.id, description: g.description });
        }
      }

      items.push({ value: "__header_constraints__", label: `── Constraints (${constraints.size}) ──`, description: "run to find violations" });
      for (const c of constraints.values()) {
        const deps = resolveConceptChain(c, concepts);
        const depsNote = deps.length > 0 ? ` [needs ${deps.length} concept${deps.length > 1 ? "s" : ""}]` : "";
        items.push({ value: `constraint:${c.id}`, label: c.id, description: c.description.slice(0, 80) + depsNote });
      }

      const conceptToggleLabel = conceptsExpanded
        ? `── Concepts (${totalConcepts}) ▾ ──`
        : `── Concepts (${totalConcepts}) ▸ ── [expand to browse]`;
      items.push({ value: "__toggle_concepts__", label: conceptToggleLabel, description: "graph-enriching write queries" });

      if (conceptsExpanded) {
        for (const c of concepts.values()) {
          items.push({ value: `concept:${c.id}`, label: c.id, description: c.description.slice(0, 80) });
        }
      }

      items.push({ value: "__close__", label: "── close ──", description: "" });
      return items;
    };

    await ctx.ui.custom<void>((tui: any, theme: any, _kb: any, done: (v: void) => void) => {
      let items = buildItems();
      const firstConstraint = items.findIndex(i => i.value.startsWith("constraint:"));
      let listRef: SelectList | null = null;

      const styledTheme = {
        selectedPrefix: (t: string) => theme.fg("accent", t),
        selectedText: (t: string) => theme.fg("accent", t),
        description: (t: string) => theme.fg("dim", t),
        scrollInfo: (t: string) => theme.fg("dim", t),
        noMatch: (t: string) => theme.fg("warning", t),
      };

      const rebuild = () => { items = buildItems(); listRef?.setItems(items); tui.requestRender(); };

      const container = new Container();
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
      container.addChild(new Text(
        theme.fg("accent", theme.bold("jQAssistant Rules Explorer")) + "  " +
        theme.fg("dim", `${groups.size} groups · ${constraints.size} constraints · ${totalConcepts} concepts`),
        1, 0,
      ));
      container.addChild(new Spacer(0));

      const selectList = new SelectList(items, 20, styledTheme);
      listRef = selectList;
      if (firstConstraint >= 0) selectList.setSelectedIndex(firstConstraint);

      selectList.onSelect = async (item: SelectItem) => {
        const val = item.value as string;
        if (val === "__close__") { done(undefined); return; }
        if (val === "__toggle_concepts__") { conceptsExpanded = !conceptsExpanded; rebuild(); return; }
        if (val.startsWith("__header_")) return;

        if (val.startsWith("group:")) {
          const id = val.slice(6);
          const group = groups.get(id)!;
          const lines = [
            `Group: ${group.id}`, `${group.description}`, "",
            group.includesConstraints?.length ? `Constraints: ${group.includesConstraints.join(", ")}` : "",
            group.includesGroups?.length ? `Sub-groups:  ${group.includesGroups.join(", ")}` : "",
          ].filter(Boolean);
          pi.sendMessage({ customType: "jqa-result", content: lines.join("\n"), display: true, details: { header: `Group: ${id}` } });
          return;
        }

        if (val.startsWith("concept:")) {
          const id = val.slice(8);
          const concept = concepts.get(id)!;
          done(undefined);
          const ok = await ctx.ui.confirm(
            `Apply concept: ${id}`,
            `${concept.description}\n\nThis will write new labels/relationships into the graph. Requires server.`,
          );
          if (!ok) return;
          try {
            const boltPort = await ensureServer(cwd, ctx);
            ctx.ui.setStatus("jqa-concept", "⏳ applying…");
            const summary = await applyConcept(concept, boltPort);
            ctx.ui.notify(`✅ ${summary}`, "info");
          } catch (e: any) {
            ctx.ui.notify(`Failed: ${e.message}`, "error");
          } finally {
            ctx.ui.setStatus("jqa-concept", undefined);
          }
          return;
        }

        if (val.startsWith("constraint:")) {
          const id = val.slice(11);
          const constraint = constraints.get(id)!;
          const depChain = resolveConceptChain(constraint, concepts);
          done(undefined);

          const depNote = depChain.length > 0
            ? `\nWill first apply ${depChain.length} concept(s): ${depChain.map(c => c.id).join(", ")}`
            : "";
          const ok = await ctx.ui.confirm(
            `Run constraint: ${id}`,
            `${constraint.description}${depNote}\n\nRequires server to be running.`,
          );
          if (!ok) return;

          ctx.ui.setStatus("jqa-constraint", "⏳ running…");
          try {
            const boltPort = await ensureServer(cwd, ctx);
            if (depChain.length > 0) {
              ctx.ui.notify(`Applying ${depChain.length} concept(s)…`, "info");
              for (const concept of depChain) {
                if (concept.cypher) await runWriteCypher(concept.cypher, boltPort);
              }
            }
            const { table, violations } = await runConstraint(constraint, boltPort);
            const header = violations === 0 ? `✅ ${id}: no violations` : `⚠️ ${id}: ${violations} violation(s)`;
            pi.sendMessage({ customType: "jqa-result", content: table, display: true, details: { header, cypher: constraint.cypher } });
          } catch (e: any) {
            ctx.ui.notify(`Constraint failed: ${e.message}`, "error");
          } finally {
            ctx.ui.setStatus("jqa-constraint", undefined);
          }
          return;
        }
      };

      selectList.onCancel = () => done(undefined);
      container.addChild(selectList);
      container.addChild(new Spacer(0));
      container.addChild(new Text(
        theme.fg("dim", "↑↓ navigate · enter select/run · esc close · type to filter"),
        1, 0,
      ));
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

      return {
        render: (w: number) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => { selectList.handleInput(data); tui.requestRender(); },
      };
    });
  }

  // ── Config helper ────────────────────────────────────────────────────────

  /**
   * Add a rule reference (concept/constraint/group) to the analyze section of
   * .jqassistant.yml. Creates the file if it doesn't exist.
   * Returns a description of what was changed.
   */
  function addRuleToConfig(cwd: string, ruleId: string, kind: "concept" | "constraint" | "group"): string {
    const configPath = join(cwd, ".jqassistant.yml");
    let content = "";
    if (existsSync(configPath)) {
      content = readFileSync(configPath, "utf-8");
    }

    // Check if rule is already referenced
    if (content.includes(ruleId)) {
      return `${ruleId} is already referenced in .jqassistant.yml`;
    }

    const groupField = kind === "group" ? "groups" : kind === "constraint" ? "constraints" : "concepts";
    const entry = `    - ${ruleId}`;

    // Try to append to existing analyze.rule-parameters section
    const analyzeRe = /^(jqassistant:\s*\n(?:[\s\S]*?))?(  analyze:\s*\n)([\s\S]*?)(?=^  \w|\z)/m;

    if (content.includes(`    ${groupField}:`)) {
      // Append to existing list
      const listRe = new RegExp(`(    ${groupField}:\\s*\\n)((?:      - [^\\n]+\\n)*)`);
      if (listRe.test(content)) {
        content = content.replace(listRe, `$1$2${entry}\n`);
        writeFileSync(configPath, content);
        return `Added ${ruleId} to analyze.rule-parameters.${groupField} in .jqassistant.yml`;
      }
    }

    if (content.includes("  analyze:")) {
      // Add new field under analyze
      content = content.replace(
        /(  analyze:\s*\n)/,
        `$1    rule-parameters:\n      ${groupField}:\n${entry}\n`,
      );
      writeFileSync(configPath, content);
      return `Added ${ruleId} under analyze.rule-parameters.${groupField} in .jqassistant.yml`;
    }

    // No analyze section yet — append it
    if (!content.endsWith("\n")) content += "\n";
    if (!content.includes("jqassistant:")) {
      content = "jqassistant:\n" + content;
    }
    content += `  analyze:\n    rule-parameters:\n      ${groupField}:\n${entry}\n`;
    writeFileSync(configPath, content);
    return `Created analyze.rule-parameters.${groupField} section with ${ruleId} in .jqassistant.yml`;
  }

  // ── Session start pre-flight ─────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    extensionCwd = ctx.cwd;
    preflightHasConfig =
      existsSync(join(ctx.cwd, ".jqassistant.yml")) ||
      existsSync(join(ctx.cwd, ".jqassistant.yaml"));

    // Staleness check: walk class files with early exit
    storeIsStale = isStoreStale(ctx.cwd);

    // Set up FS watchers for ongoing staleness detection
    setupWatchers(ctx.cwd);
  });

  // ── before_agent_start: inject jQA context into system prompt ────────────

  pi.on("before_agent_start", async (event, ctx) => {
    if (!preflightHasConfig) return;
    const staleNote = storeIsStale
      ? "The store is currently stale (compiled classes have changed since the last scan) — it will be rescanned automatically before the next query."
      : "The store is up to date.";
    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n## jQAssistant\n` +
        `.jqassistant.yml is present — the project is configured for jQAssistant analysis.\n` +
        `${staleNote}\n` +
        `Available tools: jqa_query, jqa_analyze, jqa_list_rules, jqa_apply_concept, jqa_run_constraint, jqa_add_rule_to_config.\n` +
        `Scanning is handled automatically — do not call any scan tool explicitly.`,
    };
  });

  // ── LLM Tools ────────────────────────────────────────────────────────────

  function makeToolCtx(): UiCtx {
    return { ui: { notify: () => {}, setStatus: () => {} } };
  }

  /**
   * Scan if stale, then ensure the server is running.
   * All LLM query/analyze/concept/constraint tools call this so the agent
   * never needs to call jqa_scan explicitly.
   */
  async function ensureFresh(cwd: string, ctx: UiCtx, signal?: AbortSignal): Promise<number> {
    if (storeIsStale) {
      const { ok, message } = await performScan(cwd, ctx, signal);
      if (!ok) throw new Error(`Auto-scan failed: ${message}`);
    }
    return ensureServer(cwd, ctx);
  }

  const TRUNCATE_LINES = 20;

  pi.registerTool({
    name: "jqa_query",
    label: "jQA Query",
    description:
      "Run a read-only Cypher query against the jQAssistant Neo4j store and return results as a table. " +
      "The server is started automatically if not running. " +
      "Use MATCH/RETURN patterns — do not use write clauses (use jqa_apply_concept for writes).",
    promptSnippet: "Run a Cypher query against the jQAssistant graph",
    parameters: Type.Object({
      cypher: Type.String({ description: "The Cypher query to run." }),
    }),

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("jqa_query"));
      text += "  " + theme.fg("dim", args.cypher);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Querying…"), 0, 0);

      const content = result.content[0];
      const raw = content?.type === "text" ? content.text : "";

      if (result.isError) {
        return new Text(theme.fg("error", raw), 0, 0);
      }

      const details = result.details as { rowCount?: number; cypher?: string } | undefined;
      const rowCount = details?.rowCount ?? 0;
      const summary = rowCount === 0
        ? theme.fg("dim", "(0 rows)")
        : theme.fg("success", `${rowCount} row(s)`);

      if (expanded) {
        return new Text(summary + "\n" + raw, 0, 0);
      }

      const lines = raw.split("\n");
      const truncated = lines.length > TRUNCATE_LINES;
      const visible = lines.slice(0, TRUNCATE_LINES).join("\n");
      const hint = theme.fg("muted", truncated
        ? `  …${lines.length - TRUNCATE_LINES} more line(s) · Ctrl+O to expand`
        : "  Ctrl+O to expand");
      return new Text(summary + "\n" + visible + "\n" + hint, 0, 0);
    },

    async execute(_id, params, signal) {
      const cwd = extensionCwd;
      const ctx = makeToolCtx();
      try {
        const port = await ensureFresh(cwd, ctx, signal ?? undefined);
        const { columns, rows } = await runCypher(params.cypher, port);
        const table = renderTable(columns, rows);
        return {
          content: [{ type: "text", text: table }],
          details: { cypher: params.cypher, rowCount: rows.length },
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Query failed: ${e.message}` }], isError: true };
      }
    },
  });

  pi.registerTool({
    name: "jqa_analyze",
    label: "jQA Analyze",
    description:
      "Run jQAssistant analysis (apply concepts and check constraints defined in jqassistant/rules/). " +
      "Returns rule results and any violations found.",
    promptSnippet: "Run jQAssistant rules analysis",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      const cwd = extensionCwd;
      const rulesDir = join(cwd, "jqassistant", "rules");
      if (!existsSync(rulesDir)) {
        return {
          content: [{ type: "text", text: "No rules directory found at jqassistant/rules/. Use jqa_add_rule_to_config to add rules, or jqa_list_rules to browse available rules." }],
          isError: true,
        };
      }
      const ctx = makeToolCtx();
      try {
        if (storeIsStale) {
          const { ok, message } = await performScan(cwd, ctx, signal ?? undefined);
          if (!ok) return { content: [{ type: "text", text: `Auto-scan failed: ${message}` }], isError: true };
        }
        const { stdout, stderr, code } = await runJqa("analyze", [], cwd, signal ?? undefined);
        const out = stripLogNoise(stdout + "\n" + stderr);
        return {
          content: [{ type: "text", text: out || "(no output)" }],
          isError: code !== 0,
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Analyze failed: ${e.message}` }], isError: true };
      }
    },
  });

  pi.registerTool({
    name: "jqa_list_rules",
    label: "jQA List Rules",
    description:
      "List all available jQAssistant rules (concepts, constraints, groups) from active plugins. " +
      "Use this to discover rule IDs before calling jqa_apply_concept, jqa_run_constraint, or jqa_add_rule_to_config.",
    promptSnippet: "List available jQAssistant rules",
    parameters: Type.Object({
      filter: Type.Optional(Type.String({ description: "Optional substring filter on rule IDs." })),
    }),

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("jqa_list_rules"));
      const filterLabel = args.filter ? args.filter : "(all)";
      text += "  " + theme.fg("dim", `filter: ${filterLabel}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Loading rules…"), 0, 0);

      const content = result.content[0];
      const raw = content?.type === "text" ? content.text : "";

      if (!raw || raw === "No rules found matching the filter.") {
        const details = result.details as { filter?: string } | undefined;
        const filterLabel = details?.filter ?? "(all)";
        return new Text(
          theme.fg("warning", "No rules found") + theme.fg("dim", ` matching filter: ${filterLabel}`),
          0, 0,
        );
      }

      const details = result.details as { nGroups: number; nConstraints: number; nConcepts: number; filter?: string } | undefined;
      const nGroups      = details?.nGroups      ?? 0;
      const nConstraints = details?.nConstraints ?? 0;
      const nConcepts    = details?.nConcepts    ?? 0;
      const total = nGroups + nConstraints + nConcepts;

      const parts: string[] = [];
      if (nGroups > 0)      parts.push(`${nGroups} groups`);
      if (nConstraints > 0) parts.push(`${nConstraints} constraints`);
      if (nConcepts > 0)    parts.push(`${nConcepts} concepts`);
      const breakdown = parts.join(", ");
      let summary = theme.fg("success", `${total} rules`) + theme.fg("dim", ` (${breakdown})`);
      const filterLabel = details?.filter;
      if (filterLabel)      summary += theme.fg("dim", `  filter: ${filterLabel}`);

      if (!expanded) {
        summary += theme.fg("muted", "  Ctrl+O to expand");
        return new Text(summary, 0, 0);
      }

      return new Text(summary + "\n" + raw, 0, 0);
    },

    async execute(_id, params) {
      const cwd = extensionCwd;
      const ruleset = loadAllRules(cwd);
      const { concepts, constraints, groups } = ruleset;
      const filter = params.filter?.toLowerCase();

      const fmt = (map: Map<string, Rule>, label: string): string => {
        const entries = [...map.values()]
          .filter(r => !filter || r.id.toLowerCase().includes(filter))
          .map(r => `  ${r.id}: ${r.description.slice(0, 80)}`);
        return entries.length > 0 ? `${label} (${entries.length}):\n${entries.join("\n")}` : "";
      };

      const matchedGroups      = [...groups.values()]     .filter(r => !filter || r.id.toLowerCase().includes(filter));
      const matchedConstraints = [...constraints.values()].filter(r => !filter || r.id.toLowerCase().includes(filter));
      const matchedConcepts    = [...concepts.values()]   .filter(r => !filter || r.id.toLowerCase().includes(filter));

      const sections = [
        matchedGroups.length      > 0 ? `Groups (${matchedGroups.length}):\n${matchedGroups.map(r => `  ${r.id}: ${r.description.slice(0, 80)}`).join("\n")}` : "",
        matchedConstraints.length > 0 ? `Constraints (${matchedConstraints.length}):\n${matchedConstraints.map(r => `  ${r.id}: ${r.description.slice(0, 80)}`).join("\n")}` : "",
        matchedConcepts.length    > 0 ? `Concepts (${matchedConcepts.length}):\n${matchedConcepts.map(r => `  ${r.id}: ${r.description.slice(0, 80)}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n");

      return {
        content: [{ type: "text", text: sections || "No rules found matching the filter." }],
        details: {
          filter: params.filter ?? null,
          nGroups:      matchedGroups.length,
          nConstraints: matchedConstraints.length,
          nConcepts:    matchedConcepts.length,
        },
      };
    },
  });

  pi.registerTool({
    name: "jqa_apply_concept",
    label: "jQA Apply Concept",
    description:
      "Apply a jQAssistant concept by ID. Concepts are write queries that enrich the graph with derived " +
      "labels and relationships (e.g. mark cyclic dependencies). " +
      "The server is started automatically. Transitive concept dependencies are applied first.",
    promptSnippet: "Apply a jQAssistant concept to the graph",
    parameters: Type.Object({
      conceptId: Type.String({ description: "The concept ID to apply (e.g. 'java:Cycles')." }),
    }),
    async execute(_id, params, signal) {
      const cwd = extensionCwd;
      const ruleset = loadAllRules(cwd);
      const concept = ruleset.concepts.get(params.conceptId);
      if (!concept) {
        return {
          content: [{ type: "text", text: `Concept '${params.conceptId}' not found. Use jqa_list_rules to browse available concepts.` }],
          isError: true,
        };
      }

      const ctx = makeToolCtx();
      try {
        const boltPort = await ensureFresh(cwd, ctx, signal ?? undefined);

        // Apply transitive dependencies first
        const depChain = resolveConceptChain(concept, ruleset.concepts);
        const results: string[] = [];
        for (const dep of depChain) {
          if (dep.cypher) {
            const count = await runWriteCypher(dep.cypher, boltPort);
            results.push(`${dep.id}: ${count} affected`);
          }
        }

        // Apply the requested concept itself
        const summary = await applyConcept(concept, boltPort);
        results.push(summary);

        return { content: [{ type: "text", text: results.join("\n") }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to apply concept: ${e.message}` }], isError: true };
      }
    },
  });

  pi.registerTool({
    name: "jqa_run_constraint",
    label: "jQA Run Constraint",
    description:
      "Run a jQAssistant constraint by ID and return any violations as a table. " +
      "Required concepts are applied automatically before the constraint is checked. " +
      "The server is started automatically.",
    promptSnippet: "Run a jQAssistant constraint and return violations",
    parameters: Type.Object({
      constraintId: Type.String({ description: "The constraint ID to run (e.g. 'cycles:Packages')." }),
    }),

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("jqa_run_constraint"));
      text += "  " + theme.fg("accent", args.constraintId);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Running constraint…"), 0, 0);

      const content = result.content[0];
      const raw = content?.type === "text" ? content.text : "";

      if (result.isError) {
        return new Text(theme.fg("error", raw), 0, 0);
      }

      const details = result.details as { violations?: number; constraintId?: string } | undefined;
      const violations = details?.violations ?? 0;
      const summary = violations === 0
        ? theme.fg("success", `✅ ${details?.constraintId ?? "constraint"}: no violations`)
        : theme.fg("warning", `⚠️ ${details?.constraintId ?? "constraint"}: ${violations} violation(s)`);

      // Split off the header line the execute() prepends, then work with the table
      const lines = raw.split("\n");
      const tableLines = lines.slice(2); // skip header + blank separator
      const allLines = tableLines.length > 0 ? tableLines : lines;

      if (expanded) {
        return new Text(summary + "\n" + allLines.join("\n"), 0, 0);
      }

      const truncated = allLines.length > TRUNCATE_LINES;
      const visible = allLines.slice(0, TRUNCATE_LINES).join("\n");
      const hint = theme.fg("muted", truncated
        ? `  …${allLines.length - TRUNCATE_LINES} more line(s) · Ctrl+O to expand`
        : "  Ctrl+O to expand");
      return new Text(summary + (visible ? "\n" + visible : "") + "\n" + hint, 0, 0);
    },

    async execute(_id, params, signal) {
      const cwd = extensionCwd;
      const ruleset = loadAllRules(cwd);
      const constraint = ruleset.constraints.get(params.constraintId);
      if (!constraint) {
        return {
          content: [{ type: "text", text: `Constraint '${params.constraintId}' not found. Use jqa_list_rules to browse available constraints.` }],
          isError: true,
        };
      }

      const ctx = makeToolCtx();
      try {
        const boltPort = await ensureFresh(cwd, ctx, signal ?? undefined);

        // Apply required concepts first
        const depChain = resolveConceptChain(constraint, ruleset.concepts);
        for (const dep of depChain) {
          if (dep.cypher) await runWriteCypher(dep.cypher, boltPort);
        }

        const { table, violations } = await runConstraint(constraint, boltPort);
        const header = violations === 0
          ? `✅ ${params.constraintId}: no violations`
          : `⚠️ ${params.constraintId}: ${violations} violation(s)`;
        return {
          content: [{ type: "text", text: `${header}\n\n${table}` }],
          details: { constraintId: params.constraintId, violations },
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to run constraint: ${e.message}` }], isError: true };
      }
    },
  });

  pi.registerTool({
    name: "jqa_add_rule_to_config",
    label: "jQA Add Rule to Config",
    description:
      "Add a concept, constraint, or group reference to the analyze section of .jqassistant.yml, " +
      "so it runs automatically during 'jqassistant analyze' and in CI. " +
      "Creates the file if it doesn't exist. Use this to persist rules discovered via jqa_list_rules.",
    promptSnippet: "Add a rule reference to .jqassistant.yml",
    parameters: Type.Object({
      ruleId: Type.String({ description: "The rule ID to add (e.g. 'cycles:Packages')." }),
      kind: Type.Union([
        Type.Literal("concept"),
        Type.Literal("constraint"),
        Type.Literal("group"),
      ], { description: "Whether the rule is a concept, constraint, or group." }),
    }),
    async execute(_id, params) {
      const cwd = extensionCwd;
      try {
        const message = addRuleToConfig(cwd, params.ruleId, params.kind);
        return { content: [{ type: "text", text: `✅ ${message}` }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Failed to update config: ${e.message}` }], isError: true };
      }
    },
  });

  // ── Commands ─────────────────────────────────────────────────────────────

  pi.registerCommand("jqa", {
    description: "jQAssistant – scan | query <cypher> | analyze | explore | reset | start | stop | status",
    getArgumentCompletions: (prefix) => {
      const subs = [
        { value: "scan",    label: "scan    – Scan the project into the Neo4j store" },
        { value: "query",   label: "query   – Run a Cypher query (over Bolt)" },
        { value: "analyze", label: "analyze – Run rules/constraints" },
        { value: "explore", label: "explore – Interactive rules explorer" },
        { value: "reset",   label: "reset   – Wipe the store" },
        { value: "start",   label: "start   – Start the embedded Neo4j server" },
        { value: "stop",    label: "stop    – Stop the embedded Neo4j server" },
        { value: "status",  label: "status  – Show server status" },
      ];
      const filtered = subs.filter(s => s.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },

    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0] ?? "";
      const rest = parts.slice(1);

      switch (sub) {

        case "scan": {
          const force = rest.includes("--force");
          if (!force && !storeIsStale) {
            ctx.ui.notify("Store is up to date — skipping scan. Use '/jqa scan --force' to override.", "info");
            break;
          }
          const { ok, message } = await performScan(ctx.cwd, ctx, ctx.signal);
          if (ok) ctx.ui.notify(`✅ ${message}`, "info");
          else ctx.ui.notify(message, "error");
          break;
        }

        case "query": {
          let cypher = rest.join(" ").trim();
          if (!cypher) {
            const input = await ctx.ui.input(
              "Cypher query:",
              "MATCH (n) RETURN labels(n) AS labels, count(n) AS cnt ORDER BY cnt DESC LIMIT 10",
            );
            if (!input) return;
            cypher = input;
          }
          ctx.ui.setStatus("jqa-query", "⏳ querying…");
          try {
            const port = await ensureServer(ctx.cwd, ctx);
            const { columns, rows } = await runCypher(cypher, port);
            const table = renderTable(columns, rows);
            pi.sendMessage({ customType: "jqa-result", content: table, display: true, details: { cypher, rows: rows.length } });
          } catch (err) {
            ctx.ui.notify(`Query failed: ${(err as Error).message}`, "error");
          } finally {
            ctx.ui.setStatus("jqa-query", undefined);
          }
          break;
        }

        case "analyze": {
          const rulesDir = join(ctx.cwd, "jqassistant", "rules");
          if (!existsSync(rulesDir)) {
            pi.sendMessage({
              customType: "jqa-result",
              content: [
                "No rules directory found at jqassistant/rules/",
                "",
                "Use /jqa explore to browse available rules interactively,",
                "then create jqassistant/rules/wunderbar.adoc to define your project's rule set.",
                "",
                "See: https://jqassistant.github.io/jqassistant/current/#_rules",
              ].join("\n"),
              display: true,
              details: { header: "⚠️ analyze: no rules defined" },
            });
            break;
          }
          ctx.ui.notify("Running jQAssistant analysis…", "info");
          ctx.ui.setStatus("jqa-analyze", "⏳ analyzing…");
          try {
            const { stdout, stderr, code } = await runJqa("analyze", [], ctx.cwd, ctx.signal);
            const lines = stripLogNoise(stdout + "\n" + stderr).split("\n").filter(l => l.trim().length > 0);
            if (lines.length === 0) {
              ctx.ui.notify("Analysis complete (no output)", "info");
            } else {
              const header = code === 0 ? "✅ Analysis complete" : `⚠️ Analysis finished (exit ${code})`;
              pi.sendMessage({ customType: "jqa-result", content: lines.slice(0, 200).join("\n"), display: true, details: { header } });
            }
          } finally {
            ctx.ui.setStatus("jqa-analyze", undefined);
          }
          break;
        }

        case "explore": {
          await showRulesExplorer(ctx.cwd, ctx);
          break;
        }

        case "reset": {
          const ok = await ctx.ui.confirm("Reset jQAssistant store?", "This wipes all scanned data. Are you sure?");
          if (!ok) return;
          ctx.ui.setStatus("jqa-reset", "⏳ resetting…");
          try {
            const { code, stderr } = await runJqa("reset", [], ctx.cwd, ctx.signal);
            if (code !== 0) {
              ctx.ui.notify(`Reset failed: ${stripLogNoise(stderr).slice(0, 200)}`, "error");
            } else {
              server.ready = false;
              storeIsStale = true;
              ctx.ui.notify("✅ Store reset", "info");
            }
          } finally {
            ctx.ui.setStatus("jqa-reset", undefined);
          }
          break;
        }

        case "start": {
          if (server.process && server.ready) {
            ctx.ui.notify(`jQAssistant server is already running (bolt::${server.boltPort}, browser→ http://localhost:${server.httpPort})`, "info");
          } else {
            try {
              await ensureServer(ctx.cwd, ctx);
            } catch (err) {
              ctx.ui.notify(`Failed to start server: ${(err as Error).message}`, "error");
            }
          }
          break;
        }

        case "stop": {
          if (server.process && server.ready) {
            server.process.stdin?.destroy();
            server.process.kill("SIGTERM");
            server.process = null; server.ready = false;
            ctx.ui.notify("jQAssistant server stopped", "info");
          } else {
            ctx.ui.notify("jQAssistant server is not running", "info");
          }
          break;
        }

        case "status": {
          const boltOk = await isBoltReachable(server.boltPort);
          pi.sendMessage({
            customType: "jqa-result",
            content: [
              `Server process : ${server.process ? `running (pid ${server.process.pid})` : "not started by this session"}`,
              `Managed ready  : ${server.ready ? "yes" : "no"}`,
              `Bolt reachable : ${boltOk ? "yes" : "no"} (port ${server.boltPort})`,
              `Browser UI     : http://localhost:${server.httpPort}`,
              `Store stale    : ${storeIsStale ? "yes" : "no"}`,
            ].join("\n"),
            display: true,
            details: { header: "jQAssistant status" },
          });
          break;
        }

        default: {
          pi.sendMessage({
            customType: "jqa-result",
            content: [
              "  /jqa scan [--force]    Scan the project into the Neo4j store",
              "  /jqa query <cypher>    Run a Cypher query (prompts if omitted)",
              "  /jqa analyze           Run rules/constraints (needs jqassistant/rules/)",
              "  /jqa explore           Interactive rules explorer",
              "  /jqa reset             Wipe the store (asks for confirmation)",
              "  /jqa start             Start the embedded Neo4j server",
              "  /jqa stop              Stop the embedded Neo4j server",
              "  /jqa status            Show server/connection status",
            ].join("\n"),
            display: true,
            details: { header: "jQAssistant commands" },
          });
          break;
        }
      }
    },
  });

  // ── Message renderer ─────────────────────────────────────────────────────

  pi.registerMessageRenderer("jqa-result", (message, { expanded }, theme) => {
    const title = String(message.details?.header ?? "jqa query");
    const sub = message.details?.cypher
      ? " " + theme.fg("dim", String(message.details.cypher))
      : "";
    const header = theme.fg("accent", "▶ " + title) + sub;

    const lines = message.content.split("\n");
    if (expanded) {
      return new Text(header + "\n" + message.content, 0, 0);
    }
    const truncated = lines.length > TRUNCATE_LINES;
    const visible = lines.slice(0, TRUNCATE_LINES).join("\n");
    const hint = theme.fg("muted", truncated
      ? `  …${lines.length - TRUNCATE_LINES} more line(s) · Ctrl+O to expand`
      : "  Ctrl+O to expand");
    return new Text(header + "\n" + visible + "\n" + hint, 0, 0);
  });

  // ── Cleanup on shutdown ───────────────────────────────────────────────────

  pi.on("session_shutdown", async (_event, ctx) => {
    teardownWatchers();
    if (server.process) {
      server.process.stdin?.destroy();
      server.process.kill("SIGTERM");
      server.process = null; server.ready = false;
    }
  });
}