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
  // get_file_problems tool
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "jdtls_get_file_problems",
    label: "get_file_problems",
    description:
      "Return compiler errors, warnings, and hints for a Java source file. " +
      "Also includes project-level diagnostics (e.g. JRE mismatch). " +
      "Backed by Eclipse JDT Language Server.",
    parameters: Type.Object({
      path: Type.String({
        description:
          "Absolute path to the Java source file, or a path relative to the project root.",
      }),
    }),

    renderCall(args) {
      const filePath = (args as { path: string }).path;
      return {
        render() { return [`get_file_problems: ${filePath}`]; },
        invalidate() {},
      };
    },

    async execute(_id, params) {
      if (!server || server.status !== "ready") {
        throw new Error("jdtls is not ready — wait for 'jdtls ●' in the footer");
      }

      const { path: rawPath } = params as { path: string };
      const absPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);

      if (!existsSync(absPath)) {
        throw new Error(`File not found: ${absPath}`);
      }

      const text = readFileSync(absPath, "utf-8");
      const uri = pathToFileURL(absPath).toString();

      // Collect publishDiagnostics notifications using a quiet-period strategy.
      const collector = new DiagnosticsCollector(DIAGNOSTICS_QUIET_MS);
      const unsub = server.addNotificationListener((method, notifParams) => {
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
        server.didOpen(uri, text);
        const collected = await collector.promise;
        server.didClose(uri);
        const output = formatDiagnostics(uri, rawPath, collected);
        return {
          content: [{ type: "text" as const, text: output }],
          details: {},
        };
      } finally {
        unsub();
      }
    },
  });

  // -------------------------------------------------------------------------
  // search_symbol tool
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "jdtls_search_symbol",
    label: "search_symbol",
    description:
      "Search for Java symbols (classes, methods, fields, …) across the whole workspace by name. " +
      "Requires full indexing — returns 0 results if called before the index is ready.",
    parameters: Type.Object({
      query: Type.String({
        description: "Symbol name or prefix to search for (case-insensitive).",
      }),
    }),

    renderCall(args) {
      const { query } = args as { query: string };
      return {
        render() { return [`search_symbol: ${query}`]; },
        invalidate() {},
      };
    },

    async execute(_id, params) {
      if (!server || server.status !== "ready") {
        throw new Error("jdtls is not ready — wait for 'jdtls ●' in the footer");
      }

      const { query } = params as { query: string };

      if (!server.serviceReady) {
        return {
          content: [{
            type: "text" as const,
            text: `Indexing still in progress — workspace/symbol returns no results yet. ` +
                  `Try again in a few seconds.`,
          }],
          details: {},
        };
      }

      const raw = await server.request("workspace/symbol", { query });
      const symbols = (raw ?? []) as LspSymbolInformation[];
      return {
        content: [{ type: "text" as const, text: formatSymbols(symbols, cwd, query) }],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // get_symbol_info tool
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "jdtls_get_symbol_info",
    label: "get_symbol_info",
    description:
      "Return type information and documentation for the symbol at a given position in a file. " +
      "Line and character are 1-based (as shown by the `read` tool).",
    parameters: Type.Object({
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

    renderCall(args) {
      const { path: p, line, character } = args as { path: string; line: number; character: number };
      return {
        render() { return [`get_symbol_info: ${p}:${line}:${character}`]; },
        invalidate() {},
      };
    },

    async execute(_id, params) {
      if (!server || server.status !== "ready") {
        throw new Error("jdtls is not ready — wait for 'jdtls ●' in the footer");
      }

      const { path: rawPath, line, character } = params as {
        path: string;
        line: number;
        character: number;
      };

      const absPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
      if (!existsSync(absPath)) throw new Error(`File not found: ${absPath}`);

      const text = readFileSync(absPath, "utf-8");
      const uri = pathToFileURL(absPath).toString();

      // Convert from 1-based (user-facing) to 0-based (LSP)
      const lspLine = line - 1;
      const lspChar = character - 1;

      const result = await withOpenDoc(server, uri, text, () =>
        server!.request("textDocument/hover", {
          textDocument: { uri },
          position: { line: lspLine, character: lspChar },
        }),
      );

      return {
        content: [{ type: "text" as const, text: formatHover(result) }],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // rename_refactoring tool
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "jdtls_rename_refactoring",
    label: "rename_refactoring",
    description:
      "Rename a Java symbol (class, method, field, variable, …) at the given position " +
      "across the whole project. Only user-defined symbols can be renamed — library types " +
      "are rejected with a clear error. Line and character are 1-based.",
    parameters: Type.Object({
      path: Type.String({ description: "Absolute or project-relative path to the source file." }),
      line: Type.Number({ description: "1-based line number of the symbol to rename." }),
      character: Type.Number({ description: "1-based character offset within the line." }),
      newName: Type.String({ description: "The new name for the symbol." }),
    }),

    renderCall(args) {
      const { path: p, line, character, newName } = args as {
        path: string; line: number; character: number; newName: string;
      };
      return {
        render() { return [`rename_refactoring: ${p}:${line}:${character} → ${newName}`]; },
        invalidate() {},
      };
    },

    async execute(_id, params) {
      if (!server || server.status !== "ready") {
        throw new Error("jdtls is not ready — wait for 'jdtls ●' in the footer");
      }

      const { path: rawPath, line, character, newName } = params as {
        path: string; line: number; character: number; newName: string;
      };

      const absPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
      if (!existsSync(absPath)) throw new Error(`File not found: ${absPath}`);

      const text = readFileSync(absPath, "utf-8");
      const uri = pathToFileURL(absPath).toString();
      const position = { line: line - 1, character: character - 1 };

      const results = await withOpenDoc(server, uri, text, async () => {
        // Validate with prepareRename first for a better error on library symbols.
        try {
          await server!.request("textDocument/prepareRename", {
            textDocument: { uri },
            position,
          });
        } catch (err) {
          const code = (err as { code?: number }).code;
          if (code === -32600) {
            throw new Error(
              "Cannot rename: this symbol is defined in a library and is read-only.",
            );
          }
          throw err;
        }

        const workspaceEdit = await server!.request("textDocument/rename", {
          textDocument: { uri },
          position,
          newName,
        }) as WorkspaceEdit;

        return applyWorkspaceEdit(workspaceEdit);
      });

      return {
        content: [{
          type: "text" as const,
          text: formatApplyResult(results, cwd, `Renamed to '${newName}'`),
        }],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // reformat_file tool
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "jdtls_reformat_file",
    label: "reformat_file",
    description:
      "Reformat a Java source file according to the Eclipse/jdtls formatter settings. " +
      "Edits are applied directly to disk.",
    parameters: Type.Object({
      path: Type.String({ description: "Absolute or project-relative path to the Java source file." }),
    }),

    renderCall(args) {
      const { path: p } = args as { path: string };
      return {
        render() { return [`reformat_file: ${p}`]; },
        invalidate() {},
      };
    },

    async execute(_id, params) {
      if (!server || server.status !== "ready") {
        throw new Error("jdtls is not ready — wait for 'jdtls ●' in the footer");
      }

      const { path: rawPath } = params as { path: string };
      const absPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
      if (!existsSync(absPath)) throw new Error(`File not found: ${absPath}`);

      const text = readFileSync(absPath, "utf-8");
      const uri = pathToFileURL(absPath).toString();

      const edits = await withOpenDoc(server, uri, text, () =>
        server!.request("textDocument/formatting", {
          textDocument: { uri },
          options: { tabSize: 4, insertSpaces: true },
        }),
      ) as TextEdit[] | null;

      if (!edits || edits.length === 0) {
        return {
          content: [{ type: "text" as const, text: `${rawPath} is already formatted correctly` }],
          details: {},
        };
      }

      const original = readFileSync(absPath, "utf-8");
      const updated = applyTextEdits(original, edits);
      writeFileSync(absPath, updated, "utf-8");

      const results = [{ path: absPath, editsApplied: edits.length }];
      return {
        content: [{
          type: "text" as const,
          text: formatApplyResult(results, cwd, "Reformatted"),
        }],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // read_file tool (jar/class decompilation via jdt:// URIs)
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "jdtls_read_file",
    label: "read_file",
    description:
      "Return the source content of a library class or jar entry using its `jdt://` URI. " +
      "Obtain the URI from `get_symbol_info` by hovering on a library type reference — " +
      "jdtls embeds the full URI in the hover response.",
    parameters: Type.Object({
      uri: Type.String({
        description: "The jdt:// URI of the class file, as returned in a hover response.",
      }),
    }),

    renderCall(args) {
      const { uri } = args as { uri: string };
      return {
        render() { return [`read_file: ${uri}`]; },
        invalidate() {},
      };
    },

    async execute(_id, params) {
      if (!server || server.status !== "ready") {
        throw new Error("jdtls is not ready — wait for 'jdtls ●' in the footer");
      }

      const { uri } = params as { uri: string };
      const content = await server.request("java/classFileContents", { uri }) as string | null;

      if (!content) {
        return {
          content: [{ type: "text" as const, text: "(no source available for this URI)" }],
          details: {},
        };
      }

      return {
        content: [{ type: "text" as const, text: content }],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // code_action tool
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "jdtls_code_action",
    label: "code_action",
    description:
      "List code actions (quick fixes, refactorings, source actions) available at a position. " +
      "Without `applyTitle`, lists all actions. With `applyTitle`, applies the matching action. " +
      "Line and character are 1-based.",
    parameters: Type.Object({
      path: Type.String({ description: "Absolute or project-relative path to the Java source file." }),
      line: Type.Number({ description: "1-based line number." }),
      character: Type.Optional(Type.Number({ description: "1-based character offset (defaults to 1)." })),
      applyTitle: Type.Optional(Type.String({ description: "Exact title of the action to apply (from a prior list call)." })),
    }),

    renderCall(args) {
      const { path: p, line, character, applyTitle } = args as {
        path: string; line: number; character?: number; applyTitle?: string;
      };
      const suffix = applyTitle ? ` → apply "${applyTitle}"` : " (list)";
      return {
        render() { return [`code_action: ${p}:${line}:${character ?? 1}${suffix}`]; },
        invalidate() {},
      };
    },

    async execute(_id, params) {
      if (!server || server.status !== "ready") {
        throw new Error("jdtls is not ready — wait for 'jdtls ●' in the footer");
      }

      const { path: rawPath, line, character = 1, applyTitle } = params as {
        path: string; line: number; character?: number; applyTitle?: string;
      };

      const absPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
      if (!existsSync(absPath)) throw new Error(`File not found: ${absPath}`);

      const text = readFileSync(absPath, "utf-8");
      const uri = pathToFileURL(absPath).toString();
      const position = { line: line - 1, character: character - 1 };

      const rawActions = await withOpenDoc(server, uri, text, () =>
        server!.request("textDocument/codeAction", {
          textDocument: { uri },
          range: { start: position, end: position },
          context: { diagnostics: [], triggerKind: 1 },
        }),
      ) as LspAction[];

      const actions: LspAction[] = rawActions ?? [];

      // List mode
      if (!applyTitle) {
        return {
          content: [{ type: "text" as const, text: formatCodeActions(actions) }],
          details: {},
        };
      }

      // Apply mode
      const action = actions.find((a) => a.title === applyTitle);
      if (!action) {
        const available = actions.map((a) => `"${a.title}"`).join(", ");
        throw new Error(
          `No code action with title "${applyTitle}". Available: ${available || "(none)"}`,
        );
      }

      // Prefer a direct WorkspaceEdit if the action carries one.
      if (!isCommand(action) && action.edit) {
        const results = applyWorkspaceEdit(action.edit);
        return {
          content: [{ type: "text" as const, text: formatApplyResult(results, cwd, `Applied: ${action.title}`) }],
          details: {},
        };
      }

      // Otherwise execute the command (which may itself return a WorkspaceEdit).
      const cmd = isCommand(action) ? action : action.command;
      if (!cmd) {
        throw new Error(
          `Action "${action.title}" has neither an edit nor a command — cannot apply.`,
        );
      }

      const cmdResult = await server.request("workspace/executeCommand", {
        command: cmd.command,
        arguments: cmd.arguments ?? [],
      });

      if (
        cmdResult &&
        typeof cmdResult === "object" &&
        ("changes" in cmdResult || "documentChanges" in cmdResult)
      ) {
        const results = applyWorkspaceEdit(cmdResult as WorkspaceEdit);
        return {
          content: [{ type: "text" as const, text: formatApplyResult(results, cwd, `Applied: ${action.title}`) }],
          details: {},
        };
      }

      return {
        content: [{ type: "text" as const, text: `Applied: ${action.title}` }],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // get_project_modules tool
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "jdtls_get_project_modules",
    label: "get_project_modules",
    description:
      "List source and test directories for every module in the workspace. " +
      "Useful for understanding multi-module project layout.",
    parameters: Type.Object({}),

    renderCall(_args) {
      return {
        render() { return ["get_project_modules"]; },
        invalidate() {},
      };
    },

    async execute(_id, _params) {
      if (!server || server.status !== "ready") {
        throw new Error("jdtls is not ready — wait for 'jdtls ●' in the footer");
      }

      let raw: unknown;
      try {
        raw = await server.request("workspace/executeCommand", {
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
      return {
        content: [{ type: "text" as const, text: formatSourcePaths(paths) }],
        details: {},
      };
    },
  });

  // -------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------

  function applyToolActivation(status: ServerStatus): void {
    const allTools = pi.getAllTools().map((t) => t.name);
    const others = pi.getActiveTools().filter((n) => !JDTLS_TOOL_NAMES.includes(n));
    if (status === "ready") {
      const present = JDTLS_TOOL_NAMES.filter((n) => allTools.includes(n));
      pi.setActiveTools([...others, ...present]);
    } else {
      pi.setActiveTools(others);
    }
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
