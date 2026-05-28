import { describe, expect, it } from "vitest";
import {
  applyTextEdits,
  collectEditsFromWorkspaceEdit,
  formatApplyResult,
  type TextEdit,
} from "../workspace-edit.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function edit(
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
  newText: string,
): TextEdit {
  return {
    range: {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar },
    },
    newText,
  };
}

// ---------------------------------------------------------------------------
// applyTextEdits
// ---------------------------------------------------------------------------

describe("applyTextEdits", () => {
  it("returns content unchanged when edits list is empty", () => {
    expect(applyTextEdits("hello", [])).toBe("hello");
  });

  it("replaces a word on a single line", () => {
    // "foo bar" → "baz bar"
    const result = applyTextEdits("foo bar", [edit(0, 0, 0, 3, "baz")]);
    expect(result).toBe("baz bar");
  });

  it("inserts text at a position (start === end)", () => {
    // "helloworld" → "hello world"
    const result = applyTextEdits("helloworld", [edit(0, 5, 0, 5, " ")]);
    expect(result).toBe("hello world");
  });

  it("deletes a range (newText is empty string)", () => {
    // "hello world" → "hello"
    const result = applyTextEdits("hello world", [edit(0, 5, 0, 11, "")]);
    expect(result).toBe("hello");
  });

  it("replaces across multiple lines", () => {
    const content = "line one\nline two\nline three";
    // Replace from end of line 0 to start of line 2
    const result = applyTextEdits(content, [edit(0, 8, 2, 0, "\nreplacement\n")]);
    expect(result).toBe("line one\nreplacement\nline three");
  });

  it("applies multiple edits in reverse positional order", () => {
    // Two separate replacements: "aaa bbb ccc" → "AAA bbb CCC"
    const content = "aaa bbb ccc";
    const edits = [
      edit(0, 0, 0, 3, "AAA"),  // earlier position
      edit(0, 8, 0, 11, "CCC"), // later position
    ];
    // If applied in wrong order the offsets would shift; reverse order keeps them valid.
    const result = applyTextEdits(content, edits);
    expect(result).toBe("AAA bbb CCC");
  });

  it("handles edit on the last line (no trailing newline)", () => {
    const content = "line one\nlast";
    const result = applyTextEdits(content, [edit(1, 0, 1, 4, "LAST")]);
    expect(result).toBe("line one\nLAST");
  });

  it("handles \\r\\n line endings", () => {
    const content = "hello\r\nworld";
    // Replace 'world' which starts at line 1, char 0
    const result = applyTextEdits(content, [edit(1, 0, 1, 5, "earth")]);
    expect(result).toBe("hello\r\nearth");
  });
});

// ---------------------------------------------------------------------------
// collectEditsFromWorkspaceEdit
// ---------------------------------------------------------------------------

const URI_A = "file:///project/A.java";
const URI_B = "file:///project/B.java";
const EDITS_A: TextEdit[] = [edit(0, 0, 0, 3, "X")];
const EDITS_B: TextEdit[] = [edit(1, 0, 1, 3, "Y")];

describe("collectEditsFromWorkspaceEdit", () => {
  it("returns an empty map for an empty WorkspaceEdit", () => {
    expect(collectEditsFromWorkspaceEdit({})).toEqual(new Map());
  });

  it("collects edits from the old-style `changes` format", () => {
    const map = collectEditsFromWorkspaceEdit({
      changes: { [URI_A]: EDITS_A, [URI_B]: EDITS_B },
    });
    expect(map.get(URI_A)).toEqual(EDITS_A);
    expect(map.get(URI_B)).toEqual(EDITS_B);
  });

  it("collects edits from the new-style `documentChanges` format", () => {
    const map = collectEditsFromWorkspaceEdit({
      documentChanges: [
        { textDocument: { uri: URI_A }, edits: EDITS_A },
        { textDocument: { uri: URI_B }, edits: EDITS_B },
      ],
    });
    expect(map.get(URI_A)).toEqual(EDITS_A);
    expect(map.get(URI_B)).toEqual(EDITS_B);
  });

  it("merges multiple documentChanges entries for the same URI", () => {
    const extra: TextEdit[] = [edit(5, 0, 5, 1, "Z")];
    const map = collectEditsFromWorkspaceEdit({
      documentChanges: [
        { textDocument: { uri: URI_A }, edits: EDITS_A },
        { textDocument: { uri: URI_A }, edits: extra },
      ],
    });
    expect(map.get(URI_A)).toEqual([...EDITS_A, ...extra]);
  });

  it("ignores resource operations (entries without `edits` field)", () => {
    const map = collectEditsFromWorkspaceEdit({
      documentChanges: [
        { kind: "create", uri: URI_A } as never, // CreateFile — no `edits`
        { textDocument: { uri: URI_B }, edits: EDITS_B },
      ],
    });
    expect(map.has(URI_A)).toBe(false);
    expect(map.get(URI_B)).toEqual(EDITS_B);
  });
});

// ---------------------------------------------------------------------------
// formatApplyResult
// ---------------------------------------------------------------------------

const CWD = "/project";

describe("formatApplyResult", () => {
  it("reports no changes when results list is empty", () => {
    const out = formatApplyResult([], CWD, "Renamed 'Foo' → 'Bar'");
    expect(out).toBe("Renamed 'Foo' → 'Bar' — no changes needed");
  });

  it("reports a single changed file with correct grammar", () => {
    const out = formatApplyResult(
      [{ path: "/project/src/Foo.java", editsApplied: 1 }],
      CWD,
      "Renamed",
    );
    expect(out).toContain("1 file changed");
    expect(out).toContain("1 edit");
    expect(out).toContain("src/Foo.java");
  });

  it("reports multiple changed files with plural grammar", () => {
    const out = formatApplyResult(
      [
        { path: "/project/src/Foo.java", editsApplied: 3 },
        { path: "/project/test/FooTest.java", editsApplied: 2 },
      ],
      CWD,
      "Renamed",
    );
    expect(out).toContain("2 files changed");
    expect(out).toContain("5 edits total");
    expect(out).toContain("src/Foo.java");
    expect(out).toContain("test/FooTest.java");
  });
});
