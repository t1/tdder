import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "../tool-specs.ts";

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
