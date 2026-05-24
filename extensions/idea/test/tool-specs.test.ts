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

describe("v0.5 tool specs", () => {
  const xdebugTools = [
    "xdebug_get_debugger_status",
    "xdebug_get_stack",
    "xdebug_get_frame_values",
    "xdebug_get_threads",
    "xdebug_evaluate_expression",
    "xdebug_get_value_by_path",
    "xdebug_list_breakpoints",
    "xdebug_set_breakpoint",
    "xdebug_remove_breakpoint",
    "xdebug_start_debugger_session",
    "xdebug_control_session",
    "xdebug_set_variable",
    "xdebug_run_to_line",
  ];
  const exploreRuntime = [
    "xdebug_get_debugger_status",
    "xdebug_get_stack",
    "xdebug_get_frame_values",
    "xdebug_get_threads",
    "xdebug_evaluate_expression",
    "xdebug_get_value_by_path",
    "xdebug_list_breakpoints",
  ];
  const modifyRuntime = [
    "xdebug_set_breakpoint",
    "xdebug_remove_breakpoint",
    "xdebug_start_debugger_session",
    "xdebug_control_session",
    "xdebug_set_variable",
    "xdebug_run_to_line",
  ];

  for (const name of xdebugTools) {
    it(`${name} is registered in ALL_TOOLS`, () => {
      expect(names).toContain(name);
    });
    it(`${name} has collapseResult`, () => {
      const spec = ALL_TOOLS.find((t) => t.name === name);
      expect(spec?.collapseResult).toBeDefined();
    });
  }
  for (const name of exploreRuntime) {
    it(`${name} is explore/runtime`, () => {
      expect(ALL_TOOLS.find((t) => t.name === name)?.category).toBe("explore/runtime");
    });
  }
  for (const name of modifyRuntime) {
    it(`${name} is modify/runtime`, () => {
      expect(ALL_TOOLS.find((t) => t.name === name)?.category).toBe("modify/runtime");
    });
  }

  // executionTimeoutMs
  for (const name of ["xdebug_start_debugger_session", "xdebug_control_session", "xdebug_run_to_line"]) {
    it(`${name} has executionTimeoutMs > 5000`, () => {
      const spec = ALL_TOOLS.find((t) => t.name === name);
      expect(spec?.executionTimeoutMs).toBeGreaterThan(5000);
    });
  }

  // collapseResult summaries
  it("xdebug_get_debugger_status summary: no sessions", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_get_debugger_status")!;
    expect(collapseResult!.summary({ sessions: [] })).toBe("no sessions");
  });
  it("xdebug_get_debugger_status summary: paused session shows file:line", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_get_debugger_status")!;
    const result = collapseResult!.summary({
      sessions: [{ state: "paused", currentPosition: { filePath: "file:///project/Foo.kt", line: 42 } }],
    });
    expect(result).toMatch(/Foo\.kt:42/);
  });
  it("xdebug_get_debugger_status summary: running session shows state", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_get_debugger_status")!;
    const result = collapseResult!.summary({ sessions: [{ state: "running", name: "MyTest" }] });
    expect(result).toMatch(/running/);
  });

  it("xdebug_get_stack summary: 3 frames → '3 frames'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_get_stack")!;
    expect(collapseResult!.summary({ frames: [{}, {}, {}], totalFrames: 3 })).toBe("3 frames");
  });
  it("xdebug_get_stack summary: 1 frame → '1 frame'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_get_stack")!;
    expect(collapseResult!.summary({ frames: [{}], totalFrames: 1 })).toBe("1 frame");
  });

  it("xdebug_get_frame_values summary: counts root-level tree entries", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_get_frame_values")!;
    const tree = "├─ + this = Foo@1\n└─ + office = Bar@2\n";
    expect(collapseResult!.summary(tree)).toBe("2 variables");
  });
  it("xdebug_get_frame_values summary: 1 variable", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_get_frame_values")!;
    expect(collapseResult!.summary("└─ coder = 0\n")).toBe("1 variable");
  });
  it("xdebug_get_frame_values expanded: returns tree text as-is", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_get_frame_values")!;
    const tree = "├─ x = 1\n└─ y = 2\n";
    expect(collapseResult!.expanded!(tree, tree)).toBe(tree);
  });

  it("xdebug_get_threads summary: N threads", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_get_threads")!;
    expect(collapseResult!.summary({ threads: [], totalCount: 38 })).toBe("38 threads");
  });
  it("xdebug_get_threads summary: falls back to array length", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_get_threads")!;
    expect(collapseResult!.summary({ threads: [{}, {}] })).toBe("2 threads");
  });

  it("xdebug_evaluate_expression summary: first line of result", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_evaluate_expression")!;
    const text = "client.office(\"Hamburg\") = OfficeDTO(...)\nmore detail";
    expect(collapseResult!.summary(text)).toBe('client.office("Hamburg") = OfficeDTO(...)');
  });
  it("xdebug_evaluate_expression expanded: returns full text", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_evaluate_expression")!;
    const text = "x = 42\ndetail";
    expect(collapseResult!.expanded!(text, text)).toBe(text);
  });

  it("xdebug_get_value_by_path summary: the result text itself", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_get_value_by_path")!;
    expect(collapseResult!.summary("name = \"Hamburg\"")).toBe('name = "Hamburg"');
  });

  it("xdebug_list_breakpoints summary: N breakpoints (M enabled)", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_list_breakpoints")!;
    expect(collapseResult!.summary({ totalCount: 3, enabledCount: 1 })).toBe("3 breakpoints (1 enabled)");
  });

  it("xdebug_set_breakpoint summary: shows filename and line", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_set_breakpoint")!;
    const result = collapseResult!.summary({
      added: { file: "file:///project/Foo.kt", line: 49 },
    });
    expect(result).toMatch(/Foo\.kt:49/);
  });

  it("xdebug_remove_breakpoint summary: uses message field", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_remove_breakpoint")!;
    expect(collapseResult!.summary({ message: "Removed 1 breakpoint(s)." })).toBe("Removed 1 breakpoint(s).");
  });

  it("xdebug_start_debugger_session summary: name and state", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_start_debugger_session")!;
    expect(collapseResult!.summary({ name: "MyTest", state: "running" })).toBe("MyTest (running)");
  });

  it("xdebug_control_session summary: paused shows filename:line", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_control_session")!;
    const result = collapseResult!.summary({
      status: "paused",
      newPosition: { filePath: "file:///project/Foo.kt", line: 51 },
    });
    expect(result).toMatch(/Foo\.kt:51/);
  });
  it("xdebug_control_session summary: paused in jar shows filename:line", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_control_session")!;
    const result = collapseResult!.summary({
      status: "paused",
      newPosition: { filePath: "jar:///sdk/src.zip!/java.base/java/lang/AbstractStringBuilder.java", line: 1839 },
    });
    expect(result).toMatch(/AbstractStringBuilder\.java:1839/);
  });
  it("xdebug_control_session summary: stopped → 'session stopped'", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_control_session")!;
    expect(collapseResult!.summary({ status: "stopped" })).toBe("session stopped");
  });
  it("xdebug_control_session expanded: shows frameValues when present", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_control_session")!;
    const result = collapseResult!.expanded!(
      { status: "paused", frameValues: "└─ x = 1\n", newPosition: { filePath: "Foo.kt", line: 51 } },
      "",
    );
    expect(result).toContain("└─ x = 1");
  });

  it("xdebug_set_variable summary: shows result text", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_set_variable")!;
    expect(collapseResult!.summary("Unsupported mutation: value is not modifiable.")).toMatch(/not modifiable/);
  });

  it("xdebug_run_to_line summary: paused at line N", () => {
    const { collapseResult } = ALL_TOOLS.find((t) => t.name === "xdebug_run_to_line")!;
    expect(collapseResult!.summary({ outcome: "paused", currentPosition: { line: 51 } })).toBe("paused at line 51");
  });

  // guidance
  it("xdebug_get_debugger_status guidance mentions canonical session id", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "xdebug_get_debugger_status");
    expect(spec?.guidance).toMatch(/canonical|suffix|#/i);
  });
  it("xdebug_get_frame_values guidance mentions step response already has values", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "xdebug_get_frame_values");
    expect(spec?.guidance).toMatch(/control_session|step|already/i);
  });
  it("xdebug_evaluate_expression guidance warns about side effects", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "xdebug_evaluate_expression");
    expect(spec?.guidance).toMatch(/side effect|executes|runs for real/i);
  });
  it("xdebug_get_value_by_path guidance mentions array path format", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "xdebug_get_value_by_path");
    expect(spec?.guidance).toMatch(/array|\[/i);
  });
  it("xdebug_set_variable guidance mentions array path and immutable fields", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "xdebug_set_variable");
    expect(spec?.guidance).toMatch(/array|\[/i);
    expect(spec?.guidance).toMatch(/val|immutable|not modifiable/i);
  });
  it("xdebug_start_debugger_session guidance mentions security dialog and polling", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "xdebug_start_debugger_session");
    expect(spec?.guidance).toMatch(/allow|confirm|dialog/i);
    expect(spec?.guidance).toMatch(/poll|get_debugger_status|running/i);
  });
  it("xdebug_control_session guidance warns about pause on unowned sessions", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "xdebug_control_session");
    expect(spec?.guidance).toMatch(/pause|did not start|unowned/i);
  });
  it("xdebug_set_breakpoint guidance mentions project-relative path", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "xdebug_set_breakpoint");
    expect(spec?.guidance).toMatch(/project.relative|project-relative/i);
  });
  it("xdebug_remove_breakpoint guidance mentions cleanup", () => {
    const spec = ALL_TOOLS.find((t) => t.name === "xdebug_remove_breakpoint");
    expect(spec?.guidance).toMatch(/clean|remove|after/i);
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
