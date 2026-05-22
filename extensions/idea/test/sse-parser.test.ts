import { describe, expect, it } from "vitest";
import { parseFrames } from "../sse-parser.ts";

describe("SSE frame parser", () => {
  it("parses an endpoint frame and exposes its data", () => {
    const buffer = "event: endpoint\ndata: /message?sessionId=abc-123\n\n";

    const { frames } = parseFrames(buffer);

    expect(frames).toEqual([
      { event: "endpoint", data: "/message?sessionId=abc-123" },
    ]);
  });

  it("separates multiple frames in a single buffer", () => {
    const buffer =
      "event: endpoint\ndata: /message?sessionId=abc\n\n" +
      'event: message\ndata: {"jsonrpc":"2.0","id":1}\n\n';

    const { frames } = parseFrames(buffer);

    expect(frames).toEqual([
      { event: "endpoint", data: "/message?sessionId=abc" },
      { event: "message", data: '{"jsonrpc":"2.0","id":1}' },
    ]);
  });

  it("returns the unparsed remainder when a frame is split across chunks", () => {
    const first = parseFrames("event: endpo");
    expect(first.frames).toEqual([]);
    expect(first.remainder).toBe("event: endpo");

    const second = parseFrames(first.remainder + "int\ndata: /m?sessionId=x\n\n");
    expect(second.frames).toEqual([
      { event: "endpoint", data: "/m?sessionId=x" },
    ]);
    expect(second.remainder).toBe("");
  });
});
