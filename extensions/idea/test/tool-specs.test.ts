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
