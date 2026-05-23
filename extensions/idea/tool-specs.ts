export interface IdeaToolSpec {
  name: string;
  category: string;
  /** Optional usage hint appended to the tool description the LLM sees. */
  guidance?: string;
  /** When true, render result collapsed by default; expand with Ctrl+O to see pretty-printed JSON. */
  collapseResult?: boolean;
}

export const ALL_TOOLS: IdeaToolSpec[] = [
  // v0.1 — explore/code (read-only, static analysis)
  { name: "search_symbol", category: "explore/code", collapseResult: true },
  { name: "get_symbol_info", category: "explore/code" },
  { name: "search_in_files_by_regex", category: "explore/code" },
  { name: "find_files_by_glob", category: "explore/code" },
  { name: "list_directory_tree", category: "explore/code" },
  { name: "get_project_modules", category: "explore/code" },
  { name: "read_file", category: "explore/code" },
  { name: "get_file_problems", category: "explore/code" },
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
