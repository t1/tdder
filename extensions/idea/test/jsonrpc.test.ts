import { describe, expect, it } from "vitest";
import { parseMessage, serializeRequest } from "../jsonrpc.ts";

describe("JSON-RPC", () => {
  it("serializes a request as a JSON-RPC 2.0 envelope", () => {
    const out = serializeRequest("tools/list", {}, 7);

    expect(JSON.parse(out)).toEqual({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/list",
      params: {},
    });
  });

  it("parses a success response", () => {
    const msg = parseMessage('{"jsonrpc":"2.0","id":7,"result":{"tools":[]}}');

    expect(msg).toEqual({
      kind: "response",
      id: 7,
      result: { tools: [] },
    });
  });

  it("parses an error response", () => {
    const msg = parseMessage(
      '{"jsonrpc":"2.0","id":7,"error":{"code":-32601,"message":"Method not found"}}',
    );

    expect(msg).toEqual({
      kind: "response",
      id: 7,
      error: { code: -32601, message: "Method not found" },
    });
  });
  it("parses a notification", () => {
    const msg = parseMessage(
      '{"jsonrpc":"2.0","method":"tools/listChanged","params":{}}',
    );

    expect(msg).toEqual({
      kind: "notification",
      method: "tools/listChanged",
      params: {},
    });
  });
});
