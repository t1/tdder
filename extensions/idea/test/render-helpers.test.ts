import { describe, expect, it } from "vitest";
import { prettyPrintContent, summarizeContent } from "../render-helpers.ts";

describe("summarizeContent", () => {
  it("returns '5 results' for a JSON array of 5 items", () => {
    const input = JSON.stringify([1, 2, 3, 4, 5]);
    expect(summarizeContent(input)).toBe("5 results");
  });
  it("returns '1 result' for a JSON array of 1 item", () => {
    expect(summarizeContent(JSON.stringify(["x"]))).toBe("1 result");
  });
  it("returns '0 results' for an empty JSON array", () => {
    expect(summarizeContent(JSON.stringify([]))).toBe("0 results");
  });
  it("returns the first line for non-JSON text", () => {
    expect(summarizeContent("hello\nworld")).toBe("hello");
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
