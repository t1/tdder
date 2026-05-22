import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { Type } from "typebox";
import { McpClient } from "./mcp-client.ts";

const IDEA_BASE_URL = "http://127.0.0.1:64342";
const FOOTER_KEY = "idea";
const POLL_INTERVAL_MS = 2000;
const LOG_FILE = "/tmp/pi-idea.log";

// The 8 v0.1 tools (explore/code). All read-only.
const V01_TOOLS = [
  "search_symbol",
  "get_symbol_info",
  "search_in_files_by_regex",
  "find_files_by_glob",
  "list_directory_tree",
  "get_project_modules",
  "read_file",
  "get_file_problems",
];
const IDEA_TOOL_NAMES = V01_TOOLS.map((n) => `idea_${n}`);

function log(msg: string, err?: unknown): void {
  const line = `${new Date().toISOString()} ${msg}${err ? ` :: ${String(err)}\n${(err as Error)?.stack ?? ""}` : ""}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // best-effort logging
  }
  if (err) console.error(`[idea] ${msg}`, err);
}

type ProbeState =
  | { kind: "disconnected" }
  | { kind: "project-not-open"; openProjects: string[] }
  | { kind: "ok" };

function stateLabel(s: ProbeState): string {
  switch (s.kind) {
    case "disconnected":
      return "disconnected";
    case "project-not-open":
      return `project-not-open (open: ${s.openProjects.join(", ")})`;
    case "ok":
      return "ok";
  }
}

export default function (pi: ExtensionAPI) {
  let client: McpClient | undefined;
  let state: ProbeState = { kind: "disconnected" };
  let toolsRegistered = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let ctxRef: ExtensionContext | undefined;
  let tickInFlight = false;

  function setFooter(ctx: ExtensionContext): void {
    switch (state.kind) {
      case "ok":
        ctx.ui.setStatus(FOOTER_KEY, `idea ● (${V01_TOOLS.length} tools)`);
        break;
      case "project-not-open":
        ctx.ui.setStatus(FOOTER_KEY, "idea ⚠ not open");
        break;
      case "disconnected":
        ctx.ui.setStatus(FOOTER_KEY, undefined);
        break;
    }
  }

  function applyToolActivation(): void {
    if (!toolsRegistered) return;
    const allTools = pi.getAllTools().map((t) => t.name);
    const otherActive = pi
      .getActiveTools()
      .filter((n) => !IDEA_TOOL_NAMES.includes(n));
    if (state.kind === "ok") {
      const present = IDEA_TOOL_NAMES.filter((n) => allTools.includes(n));
      pi.setActiveTools([...otherActive, ...present]);
    } else {
      pi.setActiveTools(otherActive);
    }
  }

  async function ensureToolsRegistered(c: McpClient): Promise<void> {
    if (toolsRegistered) return;
    const allTools = (await c.listTools()) as Array<{
      name: string;
      description?: string;
    }>;
    const toRegister = allTools.filter((t) => V01_TOOLS.includes(t.name));
    log(
      `registering ${toRegister.length} v0.1 tools: ${toRegister.map((t) => t.name).join(", ")}`,
    );
    for (const tool of toRegister) {
      pi.registerTool({
        name: `idea_${tool.name}`,
        label: tool.name,
        description: `[explore/code] ${tool.description ?? ""}`,
        parameters: Type.Object({}, { additionalProperties: true }),
        async execute(_id, params) {
          if (!client) throw new Error("IDEA MCP client not initialised");
          const result = await client.callTool(tool.name, params as object);
          if (result.kind === "project-not-open") {
            throw new Error(
              `Project not open in IDEA. Currently open: ${result.openProjects.join(", ")}`,
            );
          }
          return {
            content: (result.content as Array<{ type: "text"; text: string }>) ?? [
              { type: "text" as const, text: "" },
            ],
            details: {},
          };
        },
      });
    }
    toolsRegistered = true;
  }

  async function transitionToDisconnected(prevLabel: string, err: unknown): Promise<void> {
    if (client) {
      await client.close().catch(() => {});
      client = undefined;
    }
    if (state.kind !== "disconnected") {
      state = { kind: "disconnected" };
      log(`state: ${prevLabel} → ${stateLabel(state)}`, err);
      if (ctxRef) {
        setFooter(ctxRef);
        applyToolActivation();
      }
    }
  }

  let tickCount = 0;
  async function tick(): Promise<void> {
    if (tickInFlight) return; // skip overlapping ticks
    if (!ctxRef) return; // shutting down / not yet started
    tickInFlight = true;
    tickCount++;
    const tStart = performance.now();
    const isFirst = tickCount === 1;
    if (isFirst) log("tick #1 start");
    const prevLabel = stateLabel(state);
    try {
      if (!client) {
        client = new McpClient(IDEA_BASE_URL, ctxRef.cwd);
        const tConnect = performance.now();
        try {
          await client.connect();
          if (isFirst) log(`tick #1 connect ok (${(performance.now() - tConnect).toFixed(1)}ms)`);
        } catch (err) {
          await transitionToDisconnected(prevLabel, err);
          return;
        }
      }

      let probe;
      const tProbe = performance.now();
      try {
        probe = await client.callTool("get_project_modules", {});
        if (isFirst) log(`tick #1 probe ok (${(performance.now() - tProbe).toFixed(1)}ms)`);
      } catch (err) {
        await transitionToDisconnected(prevLabel, err);
        return;
      }

      const next: ProbeState =
        probe.kind === "project-not-open"
          ? { kind: "project-not-open", openProjects: probe.openProjects }
          : { kind: "ok" };

      if (next.kind === "ok") {
        try {
          await ensureToolsRegistered(client);
        } catch (err) {
          log("tools/list during transition failed", err);
        }
      }

      const newLabel = stateLabel(next);
      if (newLabel !== prevLabel) {
        state = next;
        log(`state: ${prevLabel} → ${newLabel}`);
        if (ctxRef) {
          setFooter(ctxRef);
          applyToolActivation();
        }
      } else {
        state = next; // keep openProjects current
      }
    } finally {
      tickInFlight = false;
      if (isFirst) log(`tick #1 done (${(performance.now() - tStart).toFixed(1)}ms total)`);
    }
  }

  pi.on("session_start", (_event, ctx) => {
    log(`session_start, cwd=${ctx.cwd}, hasUI=${ctx.hasUI}`);
    ctxRef = ctx;
    tick().catch((err) => log("initial tick crashed", err));
    pollTimer = setInterval(() => {
      tick().catch((err) => log("poll tick crashed", err));
    }, POLL_INTERVAL_MS);
  });

  pi.on("session_shutdown", async () => {
    ctxRef = undefined; // signals in-flight ticks not to touch ctx
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
    if (client) {
      await client.close().catch(() => {});
      client = undefined;
    }
  });

  pi.registerCommand("idea", {
    description: "Manage the IntelliJ IDEA bridge",
    getArgumentCompletions: (prefix) => {
      const subs = [
        { value: "status", label: "status", description: "Show connection state" },
        { value: "open", label: "open", description: "Launch IDEA with the current project" },
      ];
      const filtered = subs.filter((s) => s.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const sub = args.trim();
      if (sub === "" || sub === "status") {
        // Force a fresh tick so /idea status is deterministically current.
        await tick().catch((err) => log("status-triggered tick crashed", err));
        const message =
          state.kind === "ok"
            ? `IDEA connected, ${V01_TOOLS.length} tools active`
            : state.kind === "project-not-open"
              ? `IDEA reachable but project not open. Currently open: ${state.openProjects.join(", ")}`
              : "IDEA not reachable. Run '/idea open' to launch it.";
        ctx.ui.notify(message, state.kind === "ok" ? "info" : "warning");
        return;
      }
      if (sub === "open") {
        spawn("open", ["-na", "IntelliJ IDEA", "--args", ctx.cwd], {
          detached: true,
          stdio: "ignore",
        }).unref();
        ctx.ui.notify(`Launching IntelliJ IDEA with ${ctx.cwd}`, "info");
        // One-shot fast re-probe so the footer flips sooner than the next poll.
        setTimeout(() => {
          tick().catch((err) => log("post-open tick crashed", err));
        }, 1500);
        return;
      }
      ctx.ui.notify(`Unknown subcommand: ${sub}. Try 'status' or 'open'.`, "error");
    },
  });
}
