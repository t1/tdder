export interface CollapseSpec {
  /** Returns a one-line summary. Receives the parsed JSON (or the raw string if not JSON). */
  summary(parsed: unknown): string;
  /** Returns the expanded view. Defaults to pretty-printed JSON when absent. */
  expanded?(parsed: unknown, raw: string): string;
}

export interface IdeaToolSpec {
  name: string;
  category: string;
  /** Optional usage hint appended to the tool description the LLM sees. */
  guidance?: string;
  /** When set, render result collapsed by default; expand with Ctrl+O. */
  collapseResult?: CollapseSpec;
  /** Override the default 5 s RPC timeout for long-blocking tools. */
  executionTimeoutMs?: number;
}

/** Collapse spec for tools that return plain file text (not a structured list). */
const fileContentCollapse: CollapseSpec = {
  summary: (p) => {
    const text = typeof p === "string" ? p : "";
    if (!text) return "file content";
    const n = text.split("\n").length;
    return `${n} ${n === 1 ? "line" : "lines"}`;
  },
  expanded: (p, raw) => (typeof p === "string" ? p : raw),
};

export const ALL_TOOLS: IdeaToolSpec[] = [
  // v0.1 — explore/code (read-only, static analysis)
  {
    name: "search_symbol",
    category: "explore/code",
    guidance:
      "Matching is case-insensitive substring on the symbol name." +
      " For common names, add a package qualifier to reduce noise: \"office.Office\" scopes" +
      " to the office package, while bare \"Office\" also matches fields and methods in other" +
      " packages whose names contain the word. One qualifying segment is enough —" +
      " \"office.Office\" and the full FQN return the same results." +
      " To enumerate all symbols in a package use \"package.*\", but expect a slow response" +
      " (several seconds); on large codebases it may time out." +
      " Searching by a bare package prefix returns nothing: the last segment is always" +
      " matched against symbol names, so \"de.codecentric\" finds zero results." +
      " If IDEA is currently indexing (e.g. after files were created or modified)," +
      " the first call may return 0 results even if the symbol exists." +
      " Retry once if the result seems inconsistent with what you know about the codebase.",
    collapseResult: {
      summary: (p) => {
        const n = (p as { items?: unknown[] })?.items?.length ?? 0;
        return `${n} ${n === 1 ? "symbol" : "symbols"}`;
      },
    },
  },
  { name: "get_symbol_info", category: "explore/code" },
  {
    name: "search_in_files_by_regex",
    category: "explore/code",
    collapseResult: {
      summary: (p) => {
        const n = (p as { entries?: unknown[] })?.entries?.length ?? 0;
        return `${n} ${n === 1 ? "match" : "matches"}`;
      },
    },
  },
  {
    name: "find_files_by_glob",
    category: "explore/code",
    collapseResult: {
      summary: (p) => {
        const n = (p as { files?: unknown[] })?.files?.length ?? 0;
        return `${n} ${n === 1 ? "file" : "files"}`;
      },
    },
  },
  {
    name: "list_directory_tree",
    category: "explore/code",
    guidance: "omitting maxDepth gives unlimited depth, which can produce enormous output on projects with deep subtrees (e.g. node_modules, .git/objects).",
    collapseResult: {
      summary: (p) => {
        const dir = (p as { traversedDirectory?: string })?.traversedDirectory ?? "";
        const name = dir.split("/").filter(Boolean).pop() ?? dir;
        return `${name}/`;
      },
      expanded: (p, raw) => (p as { tree?: string })?.tree ?? raw,
    },
  },
  { name: "get_project_modules", category: "explore/code" },
  {
    name: "read_file",
    category: "explore/code",
    guidance:
      "Use this for jar:// and jrt:// paths (library sources, JDK internals)." +
      " For regular project files, prefer get_file_text_by_path.",
    collapseResult: fileContentCollapse,
  },
  {
    name: "get_file_problems",
    category: "explore/code",
    collapseResult: {
      summary: (p) => {
        const n = (p as { errors?: unknown[] })?.errors?.length ?? 0;
        return `${n} ${n === 1 ? "problem" : "problems"}`;
      },
    },
  },
  // v0.4 — build / run (modify/runtime + explore/runtime)
  {
    name: "get_run_configurations",
    category: "explore/runtime",
    guidance: "Call this before execute_run_configuration to discover the names of available run configurations.",
    collapseResult: {
      summary: (p) => {
        const n = (p as { configurations?: unknown[] })?.configurations?.length ?? 0;
        return `${n} ${n === 1 ? "configuration" : "configurations"}`;
      },
    },
  },
  {
    name: "execute_run_configuration",
    category: "modify/runtime",
    guidance:
      "Call get_run_configurations first to find the configuration name." +
      " IDEA will show a 'Confirm Command Execution' security dialog — tell the user to watch for it and click Allow." +
      " With waitForExit=true (default for one-shot tasks): blocks until the process exits, returns exitCode and output." +
      " With waitForExit=false (for long-running processes like servers): returns immediately; the process cannot be stopped through this extension.",
    collapseResult: {
      summary: (p) => {
        const r = p as { exitCode?: number; output?: string };
        if (r.exitCode === undefined) return "started";
        return r.exitCode === 0 ? `exit ${r.exitCode} ✓` : `exit ${r.exitCode} ✗`;
      },
      expanded: (p, raw) => {
        const r = p as { output?: string; fullOutputPath?: string };
        const parts: string[] = [];
        if (r.output) parts.push(r.output);
        if (r.fullOutputPath) parts.push(`Log: ${r.fullOutputPath}`);
        return parts.join("\n") || raw;
      },
    },
  },
  {
    name: "build_project",
    category: "modify/runtime",
    collapseResult: {
      summary: (p) => {
        const r = p as { isSuccess?: boolean; problems?: unknown[] };
        if (r.isSuccess) return "build succeeded";
        const n = r.problems?.length ?? 0;
        return n > 0 ? `build failed (${n} ${n === 1 ? "problem" : "problems"})` : "build failed";
      },
    },
  },
  // v0.2 probe — explore/code backfills
  {
    name: "get_project_dependencies",
    category: "explore/code",
    guidance:
      "The result may be stale while a Gradle/Maven sync is in progress — no error is raised." +
      " On a brand-new project the count will be 0; on an existing project it will reflect the" +
      " previous sync. If you just modified a build file, wait for the sync to finish and retry.",
    collapseResult: {
      summary: (p) => {
        const n = (p as { dependencies?: unknown[] })?.dependencies?.length ?? 0;
        return `${n} ${n === 1 ? "dependency" : "dependencies"}`;
      },
    },
  },
  {
    name: "get_repositories",
    category: "explore/code",
    collapseResult: {
      summary: (p) => {
        const n = (p as { repositories?: unknown[] })?.repositories?.length ?? 0;
        return `${n} ${n === 1 ? "repository" : "repositories"}`;
      },
    },
  },
  {
    name: "get_file_text_by_path",
    category: "explore/code",
    guidance:
      "Use this to read regular project files by their project-relative path." +
      " For jar:// or jrt:// paths (library sources, JDK internals), use read_file instead.",
    collapseResult: fileContentCollapse,
  },
  // v0.2 — session (IDE shared workspace)
  {
    name: "get_all_open_file_paths",
    category: "explore/session",
    guidance:
      "Call this first when the user says \"this file\", \"current file\", \"the file I'm editing\"," +
      " or any other deictic reference to what's open in their editor.",
  },
  {
    name: "open_file_in_editor",
    category: "modify/session",
    guidance:
      "Call this to open a file in the developer's editor, directing their attention to it" +
      " while you answer. Prefer this over just stating a file path.",
  },
  // v0.5 — debugger (explore/runtime + modify/runtime)
  {
    name: "xdebug_get_debugger_status",
    category: "explore/runtime",
    guidance:
      "Call first to check whether a session is active and where it is paused." +
      " Use the session id returned here — not the one from xdebug_start_debugger_session," +
      " which may carry a different #N suffix — in all subsequent xdebug calls.",
    collapseResult: {
      summary: (p) => {
        const r = p as { sessions?: Array<{ state: string; name?: string; currentPosition?: { filePath?: string; line?: number } }> };
        const sessions = r.sessions ?? [];
        if (sessions.length === 0) return "no sessions";
        const paused = sessions.find((s) => s.state === "paused");
        if (paused?.currentPosition) {
          const filename = paused.currentPosition.filePath?.split("/").pop() ?? "";
          return `paused at ${filename}:${paused.currentPosition.line}`;
        }
        return `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"} (${sessions.map((s) => s.state).join(", ")})`;
      },
    },
  },
  {
    name: "xdebug_get_stack",
    category: "explore/runtime",
    guidance: "Call when a session is paused to inspect the call stack. Use frameIndex to select a frame in subsequent calls.",
    collapseResult: {
      summary: (p) => {
        const n = (p as { totalFrames?: number; frames?: unknown[] }).totalFrames
          ?? (p as { frames?: unknown[] }).frames?.length ?? 0;
        return `${n} ${n === 1 ? "frame" : "frames"}`;
      },
    },
  },
  {
    name: "xdebug_get_frame_values",
    category: "explore/runtime",
    guidance:
      "Returns local variables as a formatted text tree." +
      " Skip this call right after control_session — the step/pause response already includes frameValues inline.",
    collapseResult: {
      summary: (p) => {
        const text = typeof p === "string" ? p : "";
        const n = text.split("\n").filter((l) => l.startsWith("\u251c") || l.startsWith("\u2514")).length;
        return `${n} ${n === 1 ? "variable" : "variables"}`;
      },
      expanded: (p, raw) => (typeof p === "string" ? p : raw),
    },
  },
  {
    name: "xdebug_get_threads",
    category: "explore/runtime",
    guidance: "Returns all threads in the paused JVM — typically 30-40 for a Quarkus app. The thread with isCurrent:true is the one at the breakpoint.",
    collapseResult: {
      summary: (p) => {
        const r = p as { threads?: unknown[]; totalCount?: number };
        const n = r.totalCount ?? r.threads?.length ?? 0;
        return `${n} ${n === 1 ? "thread" : "threads"}`;
      },
    },
  },
  {
    name: "xdebug_evaluate_expression",
    category: "explore/runtime",
    guidance:
      "Evaluates an expression in the current frame. The expression runs for real — method calls happen and side effects occur." +
      " Prefer reading frame values first; use this only when you need to call a method to observe its return value.",
    collapseResult: {
      summary: (p) => {
        const text = typeof p === "string" ? p : "";
        return text.split("\n")[0]?.trim() ?? "expression evaluated";
      },
      expanded: (p, raw) => (typeof p === "string" ? p : raw),
    },
  },
  {
    name: "xdebug_get_value_by_path",
    category: "explore/runtime",
    guidance:
      "path must be a string array, not dot-notation." +
      ' E.g. ["office","address","street"] not "office.address.street".',
    collapseResult: {
      summary: (p) => {
        const text = typeof p === "string" ? p : "";
        return text.split("\n")[0]?.trim() ?? "value";
      },
      expanded: (p, raw) => (typeof p === "string" ? p : raw),
    },
  },
  {
    name: "xdebug_list_breakpoints",
    category: "explore/runtime",
    collapseResult: {
      summary: (p) => {
        const r = p as { totalCount?: number; enabledCount?: number };
        return `${r.totalCount ?? 0} breakpoints (${r.enabledCount ?? 0} enabled)`;
      },
    },
  },
  {
    name: "xdebug_set_breakpoint",
    category: "modify/runtime",
    guidance:
      "filePath is project-relative (e.g. \"src/main/java/Foo.java\"). Does not require user confirmation." +
      " Breakpoints can be set before starting a session or while paused at another breakpoint.",
    collapseResult: {
      summary: (p) => {
        const r = p as { added?: { file?: string; line?: number }; message?: string };
        if (r.added) {
          const filename = r.added.file?.split("/").pop() ?? "";
          return `breakpoint at ${filename}:${r.added.line}`;
        }
        return r.message ?? "breakpoint set";
      },
    },
  },
  {
    name: "xdebug_remove_breakpoint",
    category: "modify/runtime",
    guidance: "Use the breakpointId from xdebug_set_breakpoint or xdebug_list_breakpoints. Always clean up agent-set breakpoints after the session ends.",
    collapseResult: {
      summary: (p) => {
        const r = p as { message?: string; removedCount?: number };
        return r.message ?? `removed ${r.removedCount ?? 0} breakpoint(s)`;
      },
    },
  },
  {
    name: "xdebug_start_debugger_session",
    category: "modify/runtime",
    executionTimeoutMs: 120000,
    guidance:
      "IntelliJ IDEA will show a 'Confirm Command Execution' security dialog — the extension will notify you to switch to the IDE and click Allow." +
      " Use filePath+line to run a specific test (IDEA synthesises the run configuration); use configurationName for a stored configuration." +
      " The call returns when the process has launched (state: running), before any breakpoint is hit." +
      " Poll xdebug_get_debugger_status for state: paused to know when the breakpoint is hit.",
    collapseResult: {
      summary: (p) => {
        const r = p as { name?: string; state?: string };
        return r.name ? `${r.name} (${r.state})` : (r.state ?? "started");
      },
    },
  },
  {
    name: "xdebug_control_session",
    category: "modify/runtime",
    executionTimeoutMs: 30000,
    guidance:
      "action values: step_over, step_into, step_out, pause, resume, stop." +
      " The response includes frameValues inline — no need to call xdebug_get_frame_values separately after stepping." +
      " Do not call pause on a session you did not start.",
    collapseResult: {
      summary: (p) => {
        const r = p as { status?: string; newPosition?: { filePath?: string; line?: number } };
        if (r.status === "stopped") return "session stopped";
        if (r.status === "paused" && r.newPosition) {
          const filename = r.newPosition.filePath?.split("/").pop() ?? "";
          return `paused at ${filename}:${r.newPosition.line}`;
        }
        return r.status ?? "unknown";
      },
      expanded: (p, raw) => {
        const r = p as { frameValues?: string; newPosition?: { filePath?: string; line?: number } };
        const parts: string[] = [];
        if (r.newPosition) parts.push(`Position: ${r.newPosition.filePath}:${r.newPosition.line}`);
        if (r.frameValues) parts.push(r.frameValues);
        return parts.join("\n") || raw;
      },
    },
  },
  {
    name: "xdebug_set_variable",
    category: "modify/runtime",
    guidance:
      "path must be a string array (same format as xdebug_get_value_by_path)." +
      ' E.g. ["office","name"] not "office.name".' +
      " Fails with 'not modifiable' on val (immutable) fields — expected, not a bug.",
    collapseResult: {
      summary: (p) => {
        const text = typeof p === "string" ? p : "";
        return text.split("\n")[0]?.trim() || "variable set";
      },
      expanded: (p, raw) => (typeof p === "string" ? p : raw),
    },
  },
  {
    name: "xdebug_run_to_line",
    category: "modify/runtime",
    executionTimeoutMs: 30000,
    guidance: "Advances execution to the specified line without stepping. The line must be reachable from the current position in the current thread.",
    collapseResult: {
      summary: (p) => {
        const r = p as { outcome?: string; currentPosition?: { line?: number } };
        if (r.outcome === "paused" && r.currentPosition?.line !== undefined) {
          return `paused at line ${r.currentPosition.line}`;
        }
        return r.outcome ?? "done";
      },
    },
  },
  // v0.3 — modify/code (IDE-grade safe refactoring)
  {
    name: "rename_refactoring",
    category: "modify/code",
    guidance:
      "Use this instead of a text search-replace when renaming a symbol." +
      " It handles imports, qualified names, and JavaDoc references correctly." +
      " Does not clean up old .class files — delete them manually after renaming (see the java skill).",
  },
  {
    name: "reformat_file",
    category: "modify/code",
    guidance:
      "Use this to reformat a file according to the project's IntelliJ code style settings.",
  },
];
