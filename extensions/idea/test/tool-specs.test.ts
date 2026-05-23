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

describe("undecided v0.2-probe tools", () => {
  it("get_project_dependencies is registered as explore/code", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "get_project_dependencies");
    expect(spec?.category).toBe("explore/code");
  });
  it("get_project_dependencies has collapseResult", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "get_project_dependencies");
    expect(spec?.collapseResult).toBeDefined();
  });
  it("get_project_dependencies summary: 3 deps → '3 dependencies'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "get_project_dependencies")!;
    expect(collapseResult!.summary({ dependencies: [{}, {}, {}] })).toBe("3 dependencies");
  });
  it("get_project_dependencies summary: 1 dep → '1 dependency'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "get_project_dependencies")!;
    expect(collapseResult!.summary({ dependencies: [{}] })).toBe("1 dependency");
  });
  it("get_repositories is registered as explore/code", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "get_repositories");
    expect(spec?.category).toBe("explore/code");
  });
  it("get_repositories has collapseResult", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "get_repositories");
    expect(spec?.collapseResult).toBeDefined();
  });
  it("get_repositories summary: 2 repos → '2 repositories'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "get_repositories")!;
    expect(collapseResult!.summary({ repositories: [{}, {}] })).toBe("2 repositories");
  });
  it("get_repositories summary: 1 repo → '1 repository'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "get_repositories")!;
    expect(collapseResult!.summary({ repositories: [{}] })).toBe("1 repository");
  });
  it("get_file_text_by_path is registered as explore/code", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "get_file_text_by_path");
    expect(spec?.category).toBe("explore/code");
  });
  it("get_file_text_by_path carries guidance about when to prefer it over read_file", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "get_file_text_by_path");
    expect(spec?.guidance).toMatch(/read_file|jar/i);
  });

  it("read_file carries guidance about jar:// and jrt:// paths", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "read_file");
    expect(spec?.guidance).toMatch(/jar:\/\/|jrt:\/\//i);
  });
});

describe("v0.4 tool specs", () => {
  it("build_project is registered as modify/runtime", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "build_project");
    expect(spec?.category).toBe("modify/runtime");
  });
  it("build_project has collapseResult", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "build_project");
    expect(spec?.collapseResult).toBeDefined();
  });
  it("build_project summary: succeeded → 'build succeeded'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "build_project")!;
    expect(collapseResult!.summary({ isSuccess: true, problems: [] })).toBe("build succeeded");
  });
  it("build_project summary: failed with 2 problems → 'build failed (2 problems)'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "build_project")!;
    expect(collapseResult!.summary({ isSuccess: false, problems: [{}, {}] })).toBe("build failed (2 problems)");
  });
  it("build_project summary: failed with 1 problem → 'build failed (1 problem)'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "build_project")!;
    expect(collapseResult!.summary({ isSuccess: false, problems: [{}] })).toBe("build failed (1 problem)");
  });
  it("build_project summary: failed with 0 problems → 'build failed'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "build_project")!;
    expect(collapseResult!.summary({ isSuccess: false, problems: [] })).toBe("build failed");
  });
  it("get_run_configurations is registered as explore/runtime", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "get_run_configurations");
    expect(spec?.category).toBe("explore/runtime");
  });
  it("get_run_configurations has collapseResult", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "get_run_configurations");
    expect(spec?.collapseResult).toBeDefined();
  });
  it("get_run_configurations summary: 3 configs → '3 configurations'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "get_run_configurations")!;
    expect(collapseResult!.summary({ configurations: [{}, {}, {}] })).toBe("3 configurations");
  });
  it("get_run_configurations summary: 1 config → '1 configuration'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "get_run_configurations")!;
    expect(collapseResult!.summary({ configurations: [{}] })).toBe("1 configuration");
  });
  it("get_run_configurations has guidance about calling before execute_run_configuration", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "get_run_configurations");
    expect(spec?.guidance).toMatch(/execute_run_configuration/i);
  });
  it("execute_run_configuration is registered as modify/runtime", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "execute_run_configuration");
    expect(spec?.category).toBe("modify/runtime");
  });
  it("execute_run_configuration has collapseResult", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "execute_run_configuration");
    expect(spec?.collapseResult).toBeDefined();
  });
  it("execute_run_configuration summary: exitCode 0 → success indicator", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "execute_run_configuration")!;
    expect(collapseResult!.summary({ exitCode: 0 })).toMatch(/0.*✓|succeeded|success/i);
  });
  it("execute_run_configuration summary: exitCode non-zero → failure indicator", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "execute_run_configuration")!;
    expect(collapseResult!.summary({ exitCode: 1 })).toMatch(/1.*✗|failed|failure/i);
  });
  it("execute_run_configuration summary: no exitCode → 'started'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "execute_run_configuration")!;
    expect(collapseResult!.summary({})).toBe("started");
  });
  it("execute_run_configuration expanded: always shows fullOutputPath", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "execute_run_configuration")!;
    const result = collapseResult!.expanded!({ output: "", fullOutputPath: "/tmp/run.log" }, "");
    expect(result).toContain("/tmp/run.log");
  });
  it("execute_run_configuration expanded: also shows output when non-empty", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "execute_run_configuration")!;
    const result = collapseResult!.expanded!({ exitCode: 0, output: "hello\nworld", fullOutputPath: "/tmp/run.log" }, "");
    expect(result).toContain("hello\nworld");
    expect(result).toContain("/tmp/run.log");
  });
  it("execute_run_configuration has guidance mentioning the security dialog", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "execute_run_configuration");
    expect(spec?.guidance).toMatch(/confirm|security|dialog|allow/i);
  });
});

describe("file-reader collapse specs", () => {
  it("read_file has collapseResult", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "read_file");
    expect(spec?.collapseResult).toBeDefined();
  });
  it("read_file summary: 3-line text → '3 lines'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "read_file")!;
    expect(collapseResult!.summary("line1\nline2\nline3")).toBe("3 lines");
  });
  it("read_file summary: 1-line text → '1 line'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "read_file")!;
    expect(collapseResult!.summary("hello")).toBe("1 line");
  });
  it("read_file expanded: returns raw text", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "read_file")!;
    const raw = "public class Foo {}";
    expect(collapseResult!.expanded!(raw, raw)).toBe(raw);
  });
  it("get_file_text_by_path has collapseResult", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "get_file_text_by_path");
    expect(spec?.collapseResult).toBeDefined();
  });
  it("get_file_text_by_path summary: 3-line text → '3 lines'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "get_file_text_by_path")!;
    expect(collapseResult!.summary("a\nb\nc")).toBe("3 lines");
  });
  it("get_file_text_by_path summary: 1-line text → '1 line'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "get_file_text_by_path")!;
    expect(collapseResult!.summary("single")).toBe("1 line");
  });
  it("get_file_text_by_path expanded: returns raw text", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "get_file_text_by_path")!;
    const raw = "const x = 1;";
    expect(collapseResult!.expanded!(raw, raw)).toBe(raw);
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
