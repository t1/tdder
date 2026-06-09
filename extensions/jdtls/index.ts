/**
 * jdtls Extension for pi
 *
 * Spawns Eclipse JDT Language Server (jdtls) and exposes its Java intelligence
 * as native pi tools so the LLM can query diagnostics, search symbols, hover for
 * type info, rename, and reformat without leaving the chat.
 *
 * This is the alternative to pi-idea for when IntelliJ IDEA is not available.
 *
 * Placement: extensions/jdtls/index.ts  (part of the t1/tdder pi package)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setToolsActive } from "./vendor/tool-activation.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Type } from "typebox";
import {
  DiagnosticsCollector,
  formatDiagnostics,
  type LspDiagnostic,
} from "./diagnostics-collector.ts";
import { findJdtls, isJavaProject, JdtlsServer, type ServerStatus } from "./jdtls-server.ts";
import {
  formatHover,
  formatSymbols,
  type LspSymbolInformation,
} from "./lsp-format.ts";
import {
  formatCodeActions,
  formatSourcePaths,
  isCommand,
  type LspAction,
  type LspSourcePath,
} from "./code-action.ts";
import {
  applyTextEdits,
  applyWorkspaceEdit,
  formatApplyResult,
  type TextEdit,
  type WorkspaceEdit,
} from "./workspace-edit.ts";

const FOOTER_KEY = "jdtls";
const DIAGNOSTICS_QUIET_MS = 2000;
const LSP_INVALID_REQUEST = -32600;
const LSP_CODE_ACTION_TRIGGER_REQUESTED = 1;

/** Return shape of every jdtls tool execute callback. */
type JdtlsResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, never>;
};

/** Typed execute callback — enforces (id, params) => Promise<JdtlsResult>. */
type JdtlsExecute<TParams> = (
  id: string,
  params: TParams,
) => Promise<JdtlsResult>;

/** Wrap a JdtlsExecute into the full pi.registerTool execute signature. */
function wrapExecute<TParams extends Record<string, unknown>>(
  fn: JdtlsExecute<TParams>,
): (
  toolCallId: string,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onUpdate: unknown,
  ctx: unknown,
) => Promise<JdtlsResult> {
  return (toolCallId, params, _signal, _onUpdate, _ctx) =>
    fn(toolCallId, params as TParams);
}

/** Build a JdtlsResult — keeps `type: "text"` literal via `as const`. */
function result(text: string): JdtlsResult {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
  };
}

// Keep in sync with registerJdtlsTool calls below.
const JDTLS_TOOL_NAMES = [
  "jdtls_get_file_problems",
  "jdtls_search_symbol",
  "jdtls_get_symbol_info",
  "jdtls_rename_refactoring",
  "jdtls_reformat_file",
  "jdtls_read_file",
  "jdtls_code_action",
  "jdtls_get_project_modules",
];

function footerLabel(status: ServerStatus): string | undefined {
  switch (status) {
    case "starting": return "jdtls ◌ starting…";
    case "ready":    return "jdtls ●";
    case "error":    return "jdtls ⚠";
    case "stopped":  return undefined;
  }
}

function jdtlsToolName(label: string): string {
  return `jdtls_${label}`;
}

export default function (pi: ExtensionAPI): void {
  let server: JdtlsServer | null = null;
  let cwd = "";

  // -------------------------------------------------------------------------
  // Shared helper — open a doc for the duration of a callback, then close it
  // only if this call was the one that opened it (avoids closing a file that
  // a concurrent call has open).
  // -------------------------------------------------------------------------

  async function withOpenDoc<T>(
    srv: JdtlsServer,
    uri: string,
    text: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const wasOpen = srv.isDocOpen(uri);
    if (!wasOpen) srv.didOpen(uri, text);
    try {
      return await fn();
    } finally {
      if (!wasOpen) srv.didClose(uri);
    }
  }

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  function requireReady(): JdtlsServer {
    if (!server || server.status !== "ready") {
      throw new Error("jdtls is not ready — wait for 'jdtls ●' in the footer");
    }
    return server;
  }

  interface ResolvedFile {
    absPath: string;
    text: string;
    uri: string;
  }

  function resolveFile(rawPath: string): ResolvedFile {
    const absPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
    if (!existsSync(absPath)) throw new Error(`File not found: ${absPath}`);
    const text = readFileSync(absPath, "utf-8");
    const uri = pathToFileURL(absPath).toString();
    return { absPath, text, uri };
  }

  function simpleRenderCall(label: string, formatArgs?: (args: unknown) => string) {
    return (args: unknown) => ({
      render() { return [formatArgs ? `${label}: ${formatArgs(args)}` : label]; },
      invalidate() {},
    });
  }

  function registerJdtlsTool<TParams extends Record<string, unknown>>(
    label: string,
    description: string,
    parameters: ReturnType<typeof Type.Object>,
    execute: JdtlsExecute<TParams>,
    formatArgs?: (args: unknown) => string,
  ): void {
    const wrapped = wrapExecute(execute);
    const name = jdtlsToolName(label);
    pi.registerTool({
      name,
      label,
      description,
      parameters,
      renderCall: simpleRenderCall(label, formatArgs),
      execute: wrapped,
    });
  }

  // -------------------------------------------------------------------------
  // get_file_problems tool
  // -------------------------------------------------------------------------

  registerJdtlsTool<{ path: string }>(
    "get_file_problems",
    "Return compiler errors, warnings, and hints for a Java source file. " +
      "Also includes project-level diagnostics (e.g. JRE mismatch). " +
      "Backed by Eclipse JDT Language Server.",
    Type.Object({
      path: Type.String({
        description:
          "Absolute path to the Java source file, or a path relative to the project root.",
      }),
    }),
    (async (_id, params) => {
      const srv = requireReady();
      const { path: rawPath } = params;
      const { absPath, text, uri } = resolveFile(rawPath);

      // Collect publishDiagnostics notifications using a quiet-period strategy.
      const collector = new DiagnosticsCollector(DIAGNOSTICS_QUIET_MS);
      const unsub = srv.addNotificationListener((method, notifParams) => {
        if (method !== "textDocument/publishDiagnostics") return;
        const { uri: notifUri, diagnostics } = notifParams as {
          uri: string;
          diagnostics: LspDiagnostic[];
        };
        // Include the requested file and project-level diagnostics (empty URI).
        if (notifUri === uri || notifUri === "") {
          collector.feed(notifUri, diagnostics);
        }
      });

      try {
        srv.didOpen(uri, text);
        const collected = await collector.promise;
        srv.didClose(uri);
        const output = formatDiagnostics(uri, rawPath, collected);
        return result(output);
      } finally {
        unsub();
      }
    }),
    (a) => (a as { path: string }).path,
  );

  // -------------------------------------------------------------------------
  // search_symbol tool
  // -------------------------------------------------------------------------

  registerJdtlsTool<{ query: string }>(
    "search_symbol",
    "Search for Java symbols (classes, methods, fields, …) across the whole workspace by name. " +
      "Requires full indexing — returns 0 results if called before the index is ready.",
    Type.Object({
      query: Type.String({
        description: "Symbol name or prefix to search for (case-insensitive).",
      }),
    }),
    (async (_id, params) => {
      const srv = requireReady();
      const { query } = params;

      if (!srv.serviceReady) {
        return result(
          `Indexing still in progress — workspace/symbol returns no results yet. ` +
          `Try again in a few seconds.`,
        );
      }

      const raw = await srv.request("workspace/symbol", { query });
      const symbols = (raw ?? []) as LspSymbolInformation[];
      return result(formatSymbols(symbols, cwd, query));
    }),
    (a) => (a as { query: string }).query,
  );

  // -------------------------------------------------------------------------
  // get_symbol_info tool
  // -------------------------------------------------------------------------

  registerJdtlsTool<{ path: string; line: number; character: number }>(
    "get_symbol_info",
    "Return type information and documentation for the symbol at a given position in a file. " +
      "Line and character are 1-based (as shown by the `read` tool).",
    Type.Object({
      path: Type.String({
        description: "Absolute or project-relative path to the Java source file.",
      }),
      line: Type.Number({
        description: "1-based line number.",
      }),
      character: Type.Number({
        description: "1-based character offset within the line.",
      }),
    }),
    (async (_id, params) => {
      const srv = requireReady();
      const { path: rawPath, line, character } = params;
      const { text, uri } = resolveFile(rawPath);

      // Convert from 1-based (user-facing) to 0-based (LSP)
      const lspLine = line - 1;
      const lspChar = character - 1;

      const hover = await withOpenDoc(srv, uri, text, () =>
        srv.request("textDocument/hover", {
          textDocument: { uri },
          position: { line: lspLine, character: lspChar },
        }),
      );

      return result(formatHover(hover));
    }),
    (a) => {
      const { path: p, line, character } = a as { path: string; line: number; character: number };
      return `${p}:${line}:${character}`;
    },
  );

  // -------------------------------------------------------------------------
  // rename_refactoring tool
  // -------------------------------------------------------------------------

  registerJdtlsTool<{ path: string; line: number; character: number; newName: string }>(
    "rename_refactoring",
    "Rename a Java symbol (class, method, field, variable, …) at the given position " +
      "across the whole project. Only user-defined symbols can be renamed — library types " +
      "are rejected with a clear error. Line and character are 1-based.",
    Type.Object({
      path: Type.String({ description: "Absolute or project-relative path to the source file." }),
      line: Type.Number({ description: "1-based line number of the symbol to rename." }),
      character: Type.Number({ description: "1-based character offset within the line." }),
      newName: Type.String({ description: "The new name for the symbol." }),
    }),
    (async (_id, params) => {
      const srv = requireReady();
      const { path: rawPath, line, character, newName } = params;
      const { text, uri } = resolveFile(rawPath);
      const position = { line: line - 1, character: character - 1 };

      const results = await withOpenDoc(srv, uri, text, async () => {
        // Validate with prepareRename first for a better error on library symbols.
        try {
          await srv.request("textDocument/prepareRename", {
            textDocument: { uri },
            position,
          });
        } catch (err) {
          const code = (err as { code?: number }).code;
          if (code === LSP_INVALID_REQUEST) {
            throw new Error(
              "Cannot rename: this symbol is defined in a library and is read-only.",
            );
          }
          throw err;
        }

        const workspaceEdit = await srv.request("textDocument/rename", {
          textDocument: { uri },
          position,
          newName,
        }) as WorkspaceEdit;

        return applyWorkspaceEdit(workspaceEdit);
      });

      return result(formatApplyResult(results, cwd, `Renamed to '${newName}'`));
    }),
    (a) => {
      const { path: p, line, character, newName } = a as { path: string; line: number; character: number; newName: string };
      return `${p}:${line}:${character} → ${newName}`;
    },
  );

  // -------------------------------------------------------------------------
  // reformat_file tool
  // -------------------------------------------------------------------------

  registerJdtlsTool<{ path: string }>(
    "reformat_file",
    "Reformat a Java source file according to the Eclipse/jdtls formatter settings. " +
      "Edits are applied directly to disk.",
    Type.Object({
      path: Type.String({ description: "Absolute or project-relative path to the Java source file." }),
    }),
    (async (_id, params) => {
      const srv = requireReady();
      const { path: rawPath } = params;
      const { absPath, text, uri } = resolveFile(rawPath);

      const edits = await withOpenDoc(srv, uri, text, () =>
        srv.request("textDocument/formatting", {
          textDocument: { uri },
          options: { tabSize: 4, insertSpaces: true },
        }),
      ) as TextEdit[] | null;

      if (!edits || edits.length === 0) {
        return result(`${rawPath} is already formatted correctly`);
      }

      const original = readFileSync(absPath, "utf-8");
      const updated = applyTextEdits(original, edits);
      writeFileSync(absPath, updated, "utf-8");

      const results = [{ path: absPath, editsApplied: edits.length }];
      return result(formatApplyResult(results, cwd, "Reformatted"));
    }),
    (a) => (a as { path: string }).path,
  );

  // -------------------------------------------------------------------------
  // read_file tool (jar/class decompilation via jdt:// URIs)
  // -------------------------------------------------------------------------

  registerJdtlsTool<{ uri: string }>(
    "read_file",
    "Return the source content of a library class or jar entry using its `jdt://` URI. " +
      "Obtain the URI from `get_symbol_info` by hovering on a library type reference — " +
      "jdtls embeds the full URI in the hover response.",
    Type.Object({
      uri: Type.String({
        description: "The jdt:// URI of the class file, as returned in a hover response.",
      }),
    }),
    (async (_id, params) => {
      const srv = requireReady();
      const { uri } = params;
      const content = await srv.request("java/classFileContents", { uri }) as string | null;

      if (!content) {
        return result("(no source available for this URI)");
      }

      return result(content);
    }),
    (a) => (a as { uri: string }).uri,
  );

  // -------------------------------------------------------------------------
  // code_action tool
  // -------------------------------------------------------------------------

  registerJdtlsTool<{ path: string; line: number; character?: number; applyTitle?: string }>(
    "code_action",
    "List code actions (quick fixes, refactorings, source actions) available at a position. " +
      "Without `applyTitle`, lists all actions. With `applyTitle`, applies the matching action. " +
      "Line and character are 1-based.",
    Type.Object({
      path: Type.String({ description: "Absolute or project-relative path to the Java source file." }),
      line: Type.Number({ description: "1-based line number." }),
      character: Type.Optional(Type.Number({ description: "1-based character offset (defaults to 1)." })),
      applyTitle: Type.Optional(Type.String({ description: "Exact title of the action to apply (from a prior list call)." })),
    }),
    (async (_id, params) => {
      const srv = requireReady();
      const { path: rawPath, line, character = 1, applyTitle } = params;
      const { text, uri } = resolveFile(rawPath);
      const position = { line: line - 1, character: character - 1 };

      const rawActions = await withOpenDoc(srv, uri, text, () =>
        srv.request("textDocument/codeAction", {
          textDocument: { uri },
          range: { start: position, end: position },
          context: { diagnostics: [], triggerKind: LSP_CODE_ACTION_TRIGGER_REQUESTED },
        }),
      ) as LspAction[];

      const actions: LspAction[] = rawActions ?? [];

      // List mode
      if (!applyTitle) {
        return result(formatCodeActions(actions));
      }

      // Apply mode
      const action = actions.find((a) => a.title === applyTitle);
      if (!action) {
        const available = actions.map((a) => `"${a.title}"`).join(", ");
        throw new Error(
          `No code action with title "${applyTitle}". Available: ${available || "(none)"}`,
        );
      }

      return applyCodeAction(action, srv);
    }),
    (a) => {
      const { path: p, line, character, applyTitle } = a as { path: string; line: number; character?: number; applyTitle?: string };
      const suffix = applyTitle ? ` → apply "${applyTitle}"` : " (list)";
      return `${p}:${line}:${character ?? 1}${suffix}`;
    },
  );

  // -------------------------------------------------------------------------
  // code_action helpers
  // -------------------------------------------------------------------------

  async function applyCodeAction(
    action: LspAction,
    srv: JdtlsServer,
  ): Promise<JdtlsResult> {
    // Prefer a direct WorkspaceEdit if the action carries one.
    if (!isCommand(action) && action.edit) {
      const results = applyWorkspaceEdit(action.edit);
      return result(formatApplyResult(results, cwd, `Applied: ${action.title}`));
    }

    // Otherwise execute the command (which may itself return a WorkspaceEdit).
    const cmd = isCommand(action) ? action : action.command;
    if (!cmd) {
      throw new Error(
        `Action "${action.title}" has neither an edit nor a command — cannot apply.`,
      );
    }

    const cmdResult = await srv.request("workspace/executeCommand", {
      command: cmd.command,
      arguments: cmd.arguments ?? [],
    });

    if (
      cmdResult &&
      typeof cmdResult === "object" &&
      ("changes" in cmdResult || "documentChanges" in cmdResult)
    ) {
      const results = applyWorkspaceEdit(cmdResult as WorkspaceEdit);
      return result(formatApplyResult(results, cwd, `Applied: ${action.title}`));
    }
    return result(`Applied: ${action.title}`);
  }

  // -------------------------------------------------------------------------
  // get_project_modules tool
  // -------------------------------------------------------------------------

  registerJdtlsTool<{}>(
    "get_project_modules",
    "List source and test directories for every module in the workspace. " +
      "Useful for understanding multi-module project layout.",
    Type.Object({}),
    (async (_id, _params) => {
      const srv = requireReady();

      let raw: unknown;
      try {
        raw = await srv.request("workspace/executeCommand", {
          command: "java.project.listSourcePaths",
          arguments: [],
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `get_project_modules: jdtls returned an error — ${msg}. ` +
          `This command requires jdtls ≥0.57 and a configured workspace.`,
        );
      }

      const paths = (Array.isArray(raw) ? raw : []) as LspSourcePath[];
      return result(formatSourcePaths(paths));
    }),
  );

  // -------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------

  function applyToolActivation(status: ServerStatus): void {
    setToolsActive(pi, JDTLS_TOOL_NAMES, status === "ready");
  }

  pi.on("session_start", (_event, ctx) => {
    cwd = ctx.cwd;

    // Only activate for Java projects that have jdtls installed.
    if (!isJavaProject(ctx.cwd)) return;
    if (!findJdtls()) return;

    server = new JdtlsServer((status: ServerStatus) => {
      ctx.ui.setStatus(FOOTER_KEY, footerLabel(status));
      applyToolActivation(status);
    });

    // Start in the background; errors surface via the ⚠ footer indicator.
    server.start(ctx.cwd).catch((err: unknown) => {
      console.error("[jdtls] failed to start:", (err as Error).message);
    });
  });

  pi.on("session_shutdown", async () => {
    if (server) {
      await server.shutdown().catch(() => {});
      server = null;
    }
  });
}
