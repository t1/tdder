import { describe, expect, it } from "vitest";
import {
  formatCodeActions,
  formatSourcePaths,
  isCommand,
  type LspAction,
  type LspCodeAction,
  type LspCommand,
  type LspSourcePath,
} from "../code-action.ts";

// ---------------------------------------------------------------------------
// isCommand
// ---------------------------------------------------------------------------

describe("isCommand", () => {
  it("identifies a bare Command (string command field, no kind/edit)", () => {
    const cmd: LspCommand = { title: "Run tests", command: "java.test.run" };
    expect(isCommand(cmd)).toBe(true);
  });

  it("identifies a CodeAction with kind as NOT a Command", () => {
    const action: LspCodeAction = { title: "Add import", kind: "quickfix" };
    expect(isCommand(action as LspAction)).toBe(false);
  });

  it("identifies a CodeAction with edit as NOT a Command", () => {
    const action: LspCodeAction = {
      title: "Organize imports",
      edit: { changes: {} },
    };
    expect(isCommand(action as LspAction)).toBe(false);
  });

  it("identifies a CodeAction with nested command object as NOT a Command", () => {
    // The nested .command is an object, not a string.
    const action = {
      title: "Fix it",
      command: { title: "fix", command: "java.fix", arguments: [] },
    } as LspCodeAction;
    expect(isCommand(action as LspAction)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatCodeActions
// ---------------------------------------------------------------------------

describe("formatCodeActions", () => {
  it("reports nothing available when the list is empty", () => {
    expect(formatCodeActions([])).toBe("No code actions available at this position.");
  });

  it("uses singular 'action' when there is exactly one", () => {
    const actions: LspAction[] = [{ title: "Add missing import", kind: "quickfix" }];
    expect(formatCodeActions(actions)).toContain("1 code action available");
  });

  it("uses plural 'actions' when there are multiple", () => {
    const actions: LspAction[] = [
      { title: "Add import", kind: "quickfix" },
      { title: "Suppress warning", kind: "quickfix" },
    ];
    expect(formatCodeActions(actions)).toContain("2 code actions available");
  });

  it("lists each action with its 0-based index and title", () => {
    const actions: LspAction[] = [
      { title: "Organize imports", kind: "source.organizeImports" },
      { title: "Generate getter", kind: "source" },
    ];
    const output = formatCodeActions(actions);
    expect(output).toContain("0.  Organize imports");
    expect(output).toContain("1.  Generate getter");
  });

  it("appends kind in brackets when the action has one", () => {
    const actions: LspAction[] = [{ title: "Add cast", kind: "quickfix" }];
    expect(formatCodeActions(actions)).toContain("[quickfix]");
  });

  it("omits kind brackets for bare Commands", () => {
    const actions: LspAction[] = [{ title: "Run test", command: "java.test.run" }];
    // Commands have no kind field — no brackets should appear.
    const output = formatCodeActions(actions);
    expect(output).toContain("0.  Run test");
    expect(output).not.toContain("[");
  });

  it("includes the apply-instruction footer", () => {
    const actions: LspAction[] = [{ title: "Fix me", kind: "quickfix" }];
    expect(formatCodeActions(actions)).toContain("applyTitle");
  });
});

// ---------------------------------------------------------------------------
// formatSourcePaths
// ---------------------------------------------------------------------------

function sp(
  displayPath: string,
  projectName: string,
  kind: 1 | 2,
  projectType = "Maven",
): LspSourcePath {
  return { displayPath, projectName, kind, projectType };
}

describe("formatSourcePaths", () => {
  it("reports nothing found when the list is empty", () => {
    expect(formatSourcePaths([])).toBe("No source paths found in this workspace.");
  });

  it("shows the module count in the header", () => {
    const output = formatSourcePaths([sp("src/main/java", "core", 1)]);
    expect(output).toContain("Modules (1)");
  });

  it("groups source and test paths under the same project", () => {
    const paths = [
      sp("src/main/java", "app", 1),
      sp("src/test/java", "app", 2),
    ];
    const output = formatSourcePaths(paths);
    expect(output).toContain("app");
    expect(output).toContain("src:   src/main/java");
    expect(output).toContain("test:  src/test/java");
  });

  it("shows the project type in parentheses", () => {
    const output = formatSourcePaths([sp("src/main/java", "core", 1, "Gradle")]);
    expect(output).toContain("core (Gradle)");
  });

  it("handles multiple modules", () => {
    const paths = [
      sp("core/src/main/java", "core", 1),
      sp("api/src/main/java", "api", 1),
    ];
    const output = formatSourcePaths(paths);
    expect(output).toContain("Modules (2)");
    expect(output).toContain("core");
    expect(output).toContain("api");
  });

  it("omits test: line when there are no test source paths", () => {
    const output = formatSourcePaths([sp("src/main/java", "lib", 1)]);
    expect(output).not.toContain("test:");
  });

  it("omits src: line when there are only test source paths", () => {
    const output = formatSourcePaths([sp("src/test/java", "lib", 2)]);
    expect(output).not.toContain("src:");
    expect(output).toContain("test:");
  });
});
