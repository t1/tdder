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
  // v0.3 — modify/code (IDE-grade safe refactoring)
  {
    name: "rename_refactoring",
    category: "modify/code",
    guidance:
      "Use this instead of a text search-replace when renaming a symbol." +
      " It handles imports, qualified names, and JavaDoc references correctly.",
  },
  {
    name: "reformat_file",
    category: "modify/code",
    guidance:
      "Use this to reformat a file according to the project's IntelliJ code style settings.",
  },
];
