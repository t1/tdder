import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { Type, type TSchema } from "typebox";
import { McpClient } from "./mcp-client.ts";
import { parseSafe, prettyPrintContent } from "./render-helpers.ts";
import { ALL_TOOLS } from "./tool-specs.ts";

const IDEA_BASE_URL = "http://127.0.0.1:64342";
const FOOTER_KEY = "idea";
const POLL_INTERVAL_MS = 2000;
// Opt-in debug log path. Unset → no file logging (console.error still fires on errors).
const DEBUG_FILE = process.env.IDEA_MCP_DEBUG_FILE;

const TOOL_NAMES = ALL_TOOLS.map((t) => t.name);
const DIALOG_WIDGET_KEY = "idea-confirm";
const IDEA_TOOL_NAMES = ALL_TOOLS.map((t) => `idea_${t.name}`);
const CATEGORY_BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t.category]));
const GUIDANCE_BY_NAME = new Map(
  ALL_TOOLS.filter((t) => t.guidance).map((t) => [t.name, t.guidance!]),
);

// customType for the scrollable /idea tools listing.
// Rendered via registerMessageRenderer; filtered from LLM context via on("context").
const TOOLS_LIST_CUSTOM_TYPE = "idea-tools";
interface ToolsListDetails {
  tools: Array<{ name: string; category: string; description: string }>;
}

// Parameters injected by the extension for specific tools; stripped from the schema so the LLM never sees them.
const FORCED_ARGS: Record<string, Record<string, unknown>> = {
  get_file_problems: { errorsOnly: false }, // IntelliJ defaults to true (errors only); we always want warnings too.
};

let writeFailureWarned = false;
function log(msg: string, err?: unknown): void {
  if (err) console.error(`[idea] ${msg}`, err);
  if (!DEBUG_FILE) return;
  const line = `${new Date().toISOString()} ${msg}${err ? ` :: ${String(err)}\n${(err as Error)?.stack ?? ""}` : ""}\n`;
  try {
    appendFileSync(DEBUG_FILE, line);
  } catch (writeErr) {
    if (!writeFailureWarned) {
      writeFailureWarned = true;
      console.error(
        `[idea] could not write to IDEA_MCP_DEBUG_FILE=${DEBUG_FILE}:`,
        writeErr,
      );
    }
  }
}

type ProbeState =
  | { kind: "disconnected" }
  | { kind: "project-not-open"; openProjects: string[] }
  | { kind: "ok" };

/**
 * After 3 s, checks whether IDEA's security dialog is blocking `start_debugger_session`.
 * If no session has appeared yet, focuses the IDE and shows a confirm widget above the editor.
 * Returns the timer handle so the caller can cancel it in `finally`.
 */
function scheduleConfirmWidget(
  client: McpClient,
  ctxRef: ExtensionContext | undefined,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    client.callTool("xdebug_get_debugger_status", {}).then((status) => {
      const text = (status as { content?: Array<{ text: string }> }).content?.[0]?.text ?? "{}";
      const sessions = (JSON.parse(text) as { sessions?: unknown[] }).sessions ?? [];
      if (sessions.length === 0) {
        spawn("open", ["-na", "IntelliJ IDEA", "--args", ctxRef?.cwd ?? ""], {
          detached: true,
          stdio: "ignore",
        }).unref();
        ctxRef?.ui.setWidget(DIALOG_WIDGET_KEY, (_tui, theme) => ({
          render: () => [
            theme.fg("warning", "⚠ IntelliJ IDEA is waiting for your confirmation — click Allow"),
          ],
          invalidate: () => {},
        }));
      }
    }).catch(() => { /* ignore — main call may already be done */ });
  }, 3000);
}

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

  // Captured at tool-registration time so `/idea tools` doesn't need to re-query MCP.
  let registeredToolMeta: Array<{ name: string; category: string; description: string }> = [];

  function setFooter(ctx: ExtensionContext): void {
    switch (state.kind) {
      case "ok":
        ctx.ui.setStatus(FOOTER_KEY, `idea ● (${ALL_TOOLS.length} tools)`);
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

  /** Build a tool parameter schema from IntelliJ's inputSchema, stripping injected keys so the LLM never sees them. */
  function buildParameters(inputSchema: Record<string, unknown> | undefined, strip: string[]): TSchema {
    if (!inputSchema) return Type.Object({}, { additionalProperties: true }) as unknown as TSchema;
    const props = (inputSchema.properties as Record<string, unknown> | undefined) ?? {};
    const req = (inputSchema.required as string[] | undefined) ?? [];
    const stripped = new Set(strip);
    const filteredProps = Object.fromEntries(Object.entries(props).filter(([k]) => !stripped.has(k)));
    return {
      ...inputSchema,
      properties: filteredProps,
      required: req.filter((k) => !stripped.has(k)),
    } as unknown as TSchema;
  }

  async function ensureToolsRegistered(c: McpClient): Promise<void> {
    if (toolsRegistered) return;
    const allTools = (await c.listTools()) as Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;
    const toRegister = allTools.filter((t) => TOOL_NAMES.includes(t.name));
    log(
      `registering ${toRegister.length} tools: ${toRegister.map((t) => t.name).join(", ")}`,
    );
    registeredToolMeta = [];
    for (const tool of toRegister) {
      const spec = ALL_TOOLS.find((s) => s.name === tool.name);
      const category = CATEGORY_BY_NAME.get(tool.name) ?? "unknown";
      const guidance = GUIDANCE_BY_NAME.get(tool.name);
      const mcpDescription = tool.description ?? "";
      const description = guidance
        ? `[${category}]\n${guidance}\n\n${mcpDescription}`
        : `[${category}] ${mcpDescription}`;
      registeredToolMeta.push({ name: tool.name, category, description: mcpDescription });
      pi.registerTool({
        name: `idea_${tool.name}`,
        label: tool.name,
        description,
        parameters: buildParameters(tool.inputSchema, ["projectPath", ...Object.keys(FORCED_ARGS[tool.name] ?? {})]),
        renderCall(args, theme, _context) {
          const paramStr = Object.entries(args as Record<string, unknown>)
            .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
            .join(" ");
          return {
            render(width: number): string[] {
              const prefixLen = tool.name.length + 2; // "name: "
              const available = Math.max(0, width - prefixLen);
              const params =
                paramStr.length > available ? `${paramStr.slice(0, available - 1)}…` : paramStr;
              return [`${theme.fg("toolTitle", tool.name)}: ${theme.fg("dim", params)}`];
            },
            invalidate(): void {},
          };
        },
        ...(spec?.collapseResult
          ? {
              renderResult(
                result: { content?: Array<{ type: string; text: string }> },
                { expanded }: { expanded: boolean; isPartial: boolean },
                theme: { fg(color: string, text: string): string },
              ) {
                const collapse = spec!.collapseResult!;
                const rawText = result.content?.find((c) => c.type === "text")?.text ?? "";
                const parsed = parseSafe(rawText);
                const body = expanded
                  ? (collapse.expanded?.(parsed, rawText) ?? prettyPrintContent(rawText))
                  : collapse.summary(parsed) +
                    " " +
                    theme.fg("dim", keyHint("app.tools.expand", "to expand"));
                return new Text(body, 0, 0);
              },
            }
          : {}),
        async execute(_id, params) {
          if (!client) throw new Error("IDEA MCP client not initialised");
          const mergedParams = { ...(params as object), ...(FORCED_ARGS[tool.name] ?? {}) };
          const timeoutMs = spec?.executionTimeoutMs ?? 5000;

          // For xdebug_start_debugger_session: after 3 s with no session appearing,
          // IDEA is most likely showing the security dialog — show a widget and focus the IDE.
          const dialogTimer = tool.name === "xdebug_start_debugger_session"
            ? scheduleConfirmWidget(client, ctxRef)
            : undefined;

          try {
            const result = await client.callTool(tool.name, mergedParams, timeoutMs);
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
          } finally {
            if (dialogTimer !== undefined) clearTimeout(dialogTimer);
            ctxRef?.ui.setWidget(DIALOG_WIDGET_KEY, undefined);
          }
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

  // Keep our own custom messages out of the LLM context. They're for the human only.
  pi.on("context", async (event) => {
    const filtered = event.messages.filter(
      (m) => !(m.role === "custom" && m.customType === TOOLS_LIST_CUSTOM_TYPE),
    );
    return filtered.length === event.messages.length ? undefined : { messages: filtered };
  });

  // Styled in-chat renderer for the tools listing.
  pi.registerMessageRenderer<ToolsListDetails>(TOOLS_LIST_CUSTOM_TYPE, (message, _options, theme) => {
    const details = message.details;
    const tools = details?.tools ?? [];
    const lines: string[] = [];
    if (tools.length === 0) {
      lines.push(theme.fg("accent", theme.bold("IDEA tools")) + theme.fg("dim", " — none active"));
      lines.push(theme.fg("muted", "  (IDE not connected or project not open — try /idea status)"));
    } else {
      lines.push(
        theme.fg("accent", theme.bold("IDEA tools")) +
          theme.fg("dim", ` — ${tools.length} active`),
      );
      const byCategory = new Map<string, typeof tools>();
      for (const t of tools) {
        const list = byCategory.get(t.category) ?? [];
        list.push(t);
        byCategory.set(t.category, list);
      }
      const nameWidth = Math.max(...tools.map((t) => t.name.length));
      for (const [category, group] of byCategory) {
        lines.push("");
        lines.push("  " + theme.fg("muted", `${category} (${group.length})`));
        for (const t of group) {
          // First line of description only — JetBrains descriptions can be multi-paragraph.
          const firstLine = t.description.split("\n")[0]?.trim() ?? "";
          const paddedName = t.name.padEnd(nameWidth);
          lines.push(
            "    " + theme.fg("toolTitle", paddedName) + "  " + theme.fg("dim", firstLine),
          );
        }
      }
    }
    const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(lines.join("\n"), 0, 0));
    return box;
  });

  pi.registerCommand("idea", {
    description: "Manage the IntelliJ IDEA bridge",
    getArgumentCompletions: (prefix) => {
      const subs = [
        { value: "status", label: "status", description: "Show connection state" },
        { value: "open", label: "open", description: "Launch IDEA with the current project" },
        { value: "tools", label: "tools", description: "List active IDEA tools by category" },
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
            ? `IDEA connected, ${ALL_TOOLS.length} tools active`
            : state.kind === "project-not-open"
              ? `IDEA reachable but project not open. Currently open: ${state.openProjects.join(", ")}`
              : "IDEA not reachable. Run '/idea open' to launch it.";
        ctx.ui.notify(message, state.kind === "ok" ? "info" : "warning");
        return;
      }
      if (sub === "tools") {
        pi.sendMessage<ToolsListDetails>({
          customType: TOOLS_LIST_CUSTOM_TYPE,
          content: registeredToolMeta.length === 0
            ? "IDEA tools: none active"
            : `IDEA tools (${registeredToolMeta.length} active): ${registeredToolMeta.map((t) => `[${t.category}] ${t.name}`).join(", ")}`,
          display: true,
          details: { tools: [...registeredToolMeta] },
        });
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
      ctx.ui.notify(`Unknown subcommand: ${sub}. Try 'status', 'open', or 'tools'.`, "error");
    },
  });
}
