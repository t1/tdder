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
 * Placement: extensions/quarkus-mcp/index.ts  (part of the t1/tdder pi package)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateTail,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { McpClient, type McpTool } from "./mcp-client.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** The jbang alias that launches the quarkus-agent-mcp stdio server. */
const JBANG_ALIAS = "quarkus-agent-mcp@quarkusio";

/** How long (ms) to wait for the MCP server to initialise before giving up. */
const STARTUP_TIMEOUT_MS = 60_000;

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
// Extension
// ---------------------------------------------------------------------------

export default async function (pi: ExtensionAPI) {
  let client: McpClient | null = null;
  /** Tool names registered in this process (idempotent across session restarts). */
  const registered = new Set<string>();

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

    c.onClose = () => {
      if (client === c) {
        client = null;
      }
    };

    await withTimeout(c.waitReady(), STARTUP_TIMEOUT_MS, "quarkus-agent-mcp startup");
    return c;
  }

  async function ensureClient(cwd: string): Promise<McpClient> {
    if (!client) {
      client = await startClient(cwd);
      registerMcpTools(client.tools, cwd);
    }
    return client;
  }

  // -------------------------------------------------------------------------
  // Register each MCP tool as a pi tool
  // -------------------------------------------------------------------------

  function registerMcpTools(tools: McpTool[], cwd: string): void {
    for (const tool of tools) {
      if (registered.has(tool.name)) continue;
      registered.add(tool.name);

      const parameters = toTypeBox(tool.inputSchema);

      pi.registerTool({
        name: tool.name,
        label: tool.name.replace(/_/g, " "),
        description: tool.description ?? tool.name,
        promptSnippet: tool.description?.split(".")[0] ?? tool.name,
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

          // Combine all text content blocks
          const text = result.content
            .filter((c) => c.type === "text" && typeof c.text === "string")
            .map((c) => c.text as string)
            .join("\n");

          // Truncate large outputs to protect LLM context
          const truncation = truncateTail(text, {
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

        renderResult(result, { isPartial }, theme) {
          if (isPartial) {
            return new Text(theme.fg("warning", "Running…"), 0, 0);
          }
          const d = result.details as { truncated?: boolean } | undefined;
          const content = result.content[0];
          const firstLine =
            content?.type === "text"
              ? (content.text as string).split("\n")[0]?.slice(0, 120) ?? ""
              : "";
          let text = theme.fg("success", "✓ ") + theme.fg("dim", firstLine);
          if (d?.truncated) text += theme.fg("warning", " (truncated)");
          return new Text(text, 0, 0);
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  pi.on("session_start", (_event, ctx) => {
    const cwd = projectDir(ctx);

    if (!isQuarkusProject(cwd)) return;

    ctx.ui.setStatus("quarkus-mcp", "quarkus-mcp: starting…");
    // Start the MCP server in the background so it doesn't block session startup.
    ensureClient(cwd)
      .then((c) => {
        ctx.ui.setStatus("quarkus-mcp", undefined);
        ctx.ui.notify(
          `quarkus-mcp: ${c.tools.length} tools loaded`,
          "info",
        );
      })
      .catch((err) => {
        ctx.ui.setStatus("quarkus-mcp", undefined);
        ctx.ui.notify(`quarkus-mcp: failed to start – ${(err as Error).message}`, "error");
      });
  });

  pi.on("session_shutdown", async () => {
    if (client) {
      await client.close().catch(() => {});
      client = null;
    }
  });

  // -------------------------------------------------------------------------
  // /quarkus-mcp command – manual start / status / restart
  // -------------------------------------------------------------------------

  pi.registerCommand("quarkus-mcp", {
    description: "Show quarkus-mcp status, or 'restart' to restart the MCP server",
    handler: async (args, ctx) => {
      const cwd = projectDir(ctx);

      if (args?.trim() === "restart") {
        if (client) {
          await client.close().catch(() => {});
          client = null;
          registered.clear();
        }
        try {
          const c = await ensureClient(cwd);
          ctx.ui.notify(`quarkus-mcp restarted: ${c.tools.length} tools`, "info");
        } catch (err) {
          ctx.ui.notify(`quarkus-mcp restart failed: ${(err as Error).message}`, "error");
        }
        return;
      }

      if (!client) {
        // Not a Quarkus project (or not started yet) — allow manual start
        if (!isQuarkusProject(cwd)) {
          const ok = await ctx.ui.confirm(
            "Not a Quarkus project",
            "No Quarkus build file detected. Start quarkus-agent-mcp anyway?",
          );
          if (!ok) return;
        }
        ctx.ui.setStatus("quarkus-mcp", "quarkus-mcp: starting…");
        try {
          const c = await ensureClient(cwd);
          ctx.ui.setStatus("quarkus-mcp", undefined);
          ctx.ui.notify(`quarkus-mcp started: ${c.tools.length} tools`, "info");
        } catch (err) {
          ctx.ui.setStatus("quarkus-mcp", undefined);
          ctx.ui.notify(`quarkus-mcp failed to start: ${(err as Error).message}`, "error");
        }
        return;
      }

      const names = client.tools.map((t) => t.name).join("\n  ");
      ctx.ui.notify(`quarkus-mcp: ${client.tools.length} tools\n  ${names}`, "info");
    },
  });
}
