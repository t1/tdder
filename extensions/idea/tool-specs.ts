export interface IdeaToolSpec {
  name: string;
  category: string;
  /** Optional usage hint appended to the tool description the LLM sees. */
  guidance?: string;
}

export const ALL_TOOLS: IdeaToolSpec[] = [
  // v0.1 — explore/code (read-only, static analysis)
  { name: "search_symbol", category: "explore/code" },
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
];
