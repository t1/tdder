import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { Type } from "typebox";
import { McpClient } from "./mcp-client.ts";

const LOG_FILE = "/tmp/pi-idea.log";
function log(msg: string, err?: unknown): void {
  const line = `${new Date().toISOString()} ${msg}${err ? ` :: ${String(err)}\n${(err as Error)?.stack ?? ""}` : ""}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // best-effort logging
  }
  if (err) console.error(`[idea] ${msg}`, err);
}

const IDEA_BASE_URL = "http://127.0.0.1:64342";
const FOOTER_KEY = "idea";

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

type ConnectionState =
  | { kind: "disconnected" }
  | { kind: "connected"; client: McpClient; toolCount: number }
  | { kind: "project-not-open"; client: McpClient; openProjects: string[] };

export default function (pi: ExtensionAPI) {
  let state: ConnectionState = { kind: "disconnected" };

  async function probeAndWire(ctx: ExtensionContext): Promise<void> {
    log(`probeAndWire start, cwd=${ctx.cwd}, hasUI=${ctx.hasUI}`);
    const client = new McpClient(IDEA_BASE_URL, ctx.cwd);
    try {
      await client.connect();
      log("MCP connect OK");
    } catch (err) {
      log("MCP connect failed", err);
      state = { kind: "disconnected" };
      ctx.ui.setStatus(FOOTER_KEY, undefined);
      await client.close().catch(() => {});
      return;
    }

    // Cheap probe: a project-scoped tool resolves either OK or with project-not-open.
    let probe;
    try {
      probe = await client.callTool("get_project_modules", {});
      log(`probe OK, kind=${probe.kind}`);
    } catch (err) {
      log("MCP probe failed", err);
      state = { kind: "disconnected" };
      ctx.ui.setStatus(FOOTER_KEY, undefined);
      await client.close().catch(() => {});
      return;
    }
    if (probe.kind === "project-not-open") {
      state = { kind: "project-not-open", client, openProjects: probe.openProjects };
      log(`setting status: idea ⚠ not open (open: ${probe.openProjects.join(", ")})`);
      ctx.ui.setStatus(FOOTER_KEY, "idea ⚠ not open");
      return;
    }

    let allTools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
    try {
      allTools = (await client.listTools()) as typeof allTools;
      log(`tools/list OK, ${allTools.length} tools returned`);
    } catch (err) {
      log("tools/list failed", err);
      state = { kind: "disconnected" };
      ctx.ui.setStatus(FOOTER_KEY, undefined);
      await client.close().catch(() => {});
      return;
    }
    const toRegister = allTools.filter((t) => V01_TOOLS.includes(t.name));
    log(`registering ${toRegister.length} v0.1 tools: ${toRegister.map((t) => t.name).join(", ")}`);

    for (const tool of toRegister) {
      pi.registerTool({
        name: `idea_${tool.name}`,
        label: tool.name,
        description: `[explore/code] ${tool.description ?? ""}`,
        parameters: Type.Object({}, { additionalProperties: true }),
        async execute(_id, params) {
          if (state.kind !== "connected") {
            throw new Error(`IDEA not connected (state: ${state.kind})`);
          }
          const result = await state.client.callTool(tool.name, params as object);
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

    state = { kind: "connected", client, toolCount: toRegister.length };
    log(`setting status: idea ● (${toRegister.length} tools)`);
    ctx.ui.setStatus(FOOTER_KEY, `idea ● (${toRegister.length} tools)`);
  }

  pi.on("session_start", (_event, ctx) => {
    log("session_start fired");
    // Do NOT await. The probe must not block pi's startup — if the MCP hangs
    // (or simply takes a second to reply), pi must still finish booting.
    // The footer fills in asynchronously when the probe completes.
    probeAndWire(ctx).catch((err) => {
      log("probeAndWire crashed", err);
      ctx.ui.setStatus(FOOTER_KEY, "idea ⚠ error");
    });
  });

  pi.on("session_shutdown", async () => {
    if (state.kind !== "disconnected") {
      await state.client.close().catch(() => {});
    }
    state = { kind: "disconnected" };
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
        ctx.ui.notify(formatStatus(state), state.kind === "connected" ? "info" : "warning");
        return;
      }
      if (sub === "open") {
        spawn("open", ["-na", "IntelliJ IDEA", "--args", ctx.cwd], {
          detached: true,
          stdio: "ignore",
        }).unref();
        ctx.ui.notify(`Launching IntelliJ IDEA with ${ctx.cwd}`, "info");
        return;
      }
      ctx.ui.notify(`Unknown subcommand: ${sub}. Try 'status' or 'open'.`, "error");
    },
  });
}

function formatStatus(state: ConnectionState): string {
  switch (state.kind) {
    case "connected":
      return `IDEA connected, ${state.toolCount} tools registered`;
    case "project-not-open":
      return `IDEA reachable but project not open. Currently open: ${state.openProjects.join(", ")}`;
    case "disconnected":
      return "IDEA not reachable. Run '/idea open' to launch it.";
  }
}
