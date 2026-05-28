import { describe, expect, it } from "vitest";
import { formatHover, formatSymbols, type LspSymbolInformation } from "../lsp-format.ts";

// ---------------------------------------------------------------------------
// formatHover
// ---------------------------------------------------------------------------

describe("formatHover", () => {
  it("returns a fallback when result is null", () => {
    expect(formatHover(null)).toBe("(no information at this position)");
  });

  it("returns a fallback when result is undefined", () => {
    expect(formatHover(undefined)).toBe("(no information at this position)");
  });

  it("returns a fallback when contents is missing", () => {
    expect(formatHover({})).toBe("(no information at this position)");
  });

  it("returns a fallback when contents array is empty", () => {
    expect(formatHover({ contents: [] })).toBe("(no information at this position)");
  });

  it("formats a plain-string contents value", () => {
    const result = formatHover({ contents: "some docs" });
    expect(result).toBe("some docs");
  });

  it("formats a MarkedString object as a fenced code block", () => {
    const result = formatHover({
      contents: { language: "java", value: "public void doSomething()" },
    });
    expect(result).toBe("```java\npublic void doSomething()\n```");
  });

  it("formats a mixed array of MarkedStrings and plain strings", () => {
    const result = formatHover({
      contents: [
        { language: "java", value: "public class Foo" },
        "Represents a Foo instance.",
      ],
    });
    expect(result).toContain("```java\npublic class Foo\n```");
    expect(result).toContain("Represents a Foo instance.");
  });

  it("filters out empty strings from the array", () => {
    const result = formatHover({ contents: ["", "useful text", "  "] });
    expect(result).toBe("useful text");
  });

  it("trims whitespace from MarkedString values", () => {
    const result = formatHover({
      contents: { language: "java", value: "  int x = 1;  " },
    });
    expect(result).toBe("```java\nint x = 1;\n```");
  });

  it("handles MarkedString with no language as plain text", () => {
    const result = formatHover({
      contents: { language: "", value: "raw text" },
    });
    expect(result).toBe("raw text");
  });
});

// ---------------------------------------------------------------------------
// formatSymbols
// ---------------------------------------------------------------------------

function sym(
  name: string,
  kind: number,
  file: string,
  line: number,
  containerName?: string,
): LspSymbolInformation {
  return {
    name,
    kind,
    containerName,
    location: {
      uri: `file:///project/${file}`,
      range: { start: { line, character: 0 } },
    },
  };
}

const CWD = "/project";

describe("formatSymbols", () => {
  it("reports no symbols found when the list is empty", () => {
    const output = formatSymbols([], CWD, "Foo");
    expect(output).toBe('No symbols found matching "Foo".');
  });

  it("includes the query in the header", () => {
    const output = formatSymbols([sym("Foo", 5, "src/Foo.java", 9)], CWD, "Foo");
    expect(output).toContain('"Foo"');
  });

  it("shows the symbol kind name", () => {
    const output = formatSymbols([sym("Foo", 5, "src/Foo.java", 9)], CWD, "Foo");
    expect(output).toContain("Class");
  });

  it("shows symbol name and relative file path with 1-based line number", () => {
    const output = formatSymbols([sym("Foo", 5, "src/Foo.java", 9)], CWD, "Foo");
    expect(output).toContain("Foo");
    expect(output).toContain("src/Foo.java:10"); // 0-based 9 → 1-based 10
  });

  it("prefixes the name with containerName when present", () => {
    const output = formatSymbols(
      [sym("doSomething", 6, "src/Foo.java", 24, "Foo")],
      CWD,
      "doSomething",
    );
    expect(output).toContain("Foo.doSomething");
  });

  it("handles multiple symbols and aligns columns", () => {
    const symbols = [
      sym("Foo", 5, "src/Foo.java", 0),
      sym("doSomethingWithALongName", 6, "src/Foo.java", 9, "Foo"),
    ];
    const output = formatSymbols(symbols, CWD, "Foo");
    expect(output).toContain("2 symbols");
    expect(output).toContain("Class");
    expect(output).toContain("Method");
  });

  it("uses kind:N fallback for unknown kind numbers", () => {
    const output = formatSymbols([sym("X", 99, "src/X.java", 0)], CWD, "X");
    expect(output).toContain("kind:99");
  });
});
