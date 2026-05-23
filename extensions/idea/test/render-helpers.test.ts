import { describe, expect, it } from "vitest";
import { parseSafe, prettyPrintContent } from "../render-helpers.ts";

describe("parseSafe", () => {
  it("returns the parsed object for valid JSON", () => {
    expect(parseSafe('{"a":1}')).toEqual({ a: 1 });
  });
  it("returns the raw string for invalid JSON", () => {
    expect(parseSafe("not json")).toBe("not json");
  });
});

describe("prettyPrintContent", () => {
  it("pretty-prints valid JSON with 2-space indentation", () => {
    const input = '[{"a":1}]';
    expect(prettyPrintContent(input)).toBe(JSON.stringify(JSON.parse(input), null, 2));
  });
  it("returns raw text unchanged for non-JSON input", () => {
    expect(prettyPrintContent("not json")).toBe("not json");
  });
});
