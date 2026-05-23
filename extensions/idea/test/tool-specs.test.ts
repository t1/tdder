import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "../tool-specs.ts";

const names = ALL_TOOLS.map((t) => t.name);

describe("tool specs", () => {
  it("get_all_open_file_paths is registered as explore/session", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "get_all_open_file_paths");
    expect(spec?.category).toBe("explore/session");
  });
  it("open_file_in_editor is registered as modify/session", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "open_file_in_editor");
    expect(spec?.category).toBe("modify/session");
  });
  it("get_all_open_file_paths carries deictic-reference guidance", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "get_all_open_file_paths");
    expect(spec?.guidance).toMatch(/current file|this file|deictic/i);
  });
  it("open_file_in_editor carries attention-directing guidance", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "open_file_in_editor");
    expect(spec?.guidance).toMatch(/attention|direct|show|open/i);
  });
});

describe("collapsed-result specs", () => {
  for (const toolName of [
    "search_symbol",
    "search_in_files_by_regex",
    "find_files_by_glob",
    "list_directory_tree",
    "get_file_problems",
  ]) {
    it(`${toolName} has collapseResult`, () => {
      const spec = ALL_TOOLS.find((t) => t.name === toolName);
      expect(spec?.collapseResult).toBeDefined();
    });
  }

  it("search_symbol summary: 3 items → '3 symbols'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "search_symbol")!;
    expect(collapseResult!.summary({ items: [{}, {}, {}] })).toBe("3 symbols");
  });
  it("search_symbol summary: 0 items → '0 symbols'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "search_symbol")!;
    expect(collapseResult!.summary({ items: [] })).toBe("0 symbols");
  });
  it("search_in_files_by_regex summary: 2 entries → '2 matches'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "search_in_files_by_regex")!;
    expect(collapseResult!.summary({ entries: [{}, {}] })).toBe("2 matches");
  });
  it("find_files_by_glob summary: 4 files → '4 files'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "find_files_by_glob")!;
    expect(collapseResult!.summary({ files: ["a", "b", "c", "d"] })).toBe("4 files");
  });
  it("list_directory_tree summary shows the directory name", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "list_directory_tree")!;
    expect(collapseResult!.summary({ traversedDirectory: "/foo/bar/baz" })).toBe("baz/");
  });
  it("list_directory_tree expanded returns tree text, not JSON", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "list_directory_tree")!;
    const tree = "foo/\n  bar.ts";
    expect(collapseResult!.expanded!({ tree }, "{\"tree\":\"...\"")).toBe(tree);
  });
  it("get_file_problems summary: 0 errors → '0 problems'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "get_file_problems")!;
    expect(collapseResult!.summary({ errors: [] })).toBe("0 problems");
  });
  it("get_file_problems summary: 2 errors → '2 problems'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "get_file_problems")!;
    expect(collapseResult!.summary({ errors: [{}, {}] })).toBe("2 problems");
  });
});

describe("v0.3 tool specs", () => {
  it("rename_refactoring is registered as modify/code", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "rename_refactoring");
    expect(spec?.category).toBe("modify/code");
  });
  it("reformat_file is registered as modify/code", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "reformat_file");
    expect(spec?.category).toBe("modify/code");
  });
  it("rename_refactoring carries guidance about imports and references", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "rename_refactoring");
    expect(spec?.guidance).toMatch(/import|reference/i);
  });
  it("reformat_file carries guidance about the project formatter", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "reformat_file");
    expect(spec?.guidance).toMatch(/format|style/i);
  });
  it("replace_text_in_file is absent from ALL_TOOLS", () => {
    expect(names).not.toContain("replace_text_in_file");
  });
  it("create_new_file is absent from ALL_TOOLS", () => {
    expect(names).not.toContain("create_new_file");
  });
});
