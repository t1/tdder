/**
 * Pins the streamable-HTTP wiring of createIdeaClient: the transport must hit
 * `<baseUrl>/stream` and send the IJ_MCP_SERVER_PROJECT_PATH header.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIdeaClient } from "../idea-client.ts";

let server: Server;
let baseUrl: string;
let lastHeaders: Record<string, string | string[] | undefined> = {};
let lastUrl = "";

function jsonRpcReply(msg: { id?: number; method?: string; params?: Record<string, unknown> }) {
  if (msg.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fake", version: "0.0.1" },
      },
    };
  }
  if (msg.method === "tools/list") {
    return { jsonrpc: "2.0", id: msg.id, result: { tools: [] } };
  }
  if (msg.id !== undefined) return { jsonrpc: "2.0", id: msg.id, result: {} };
  return null;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    lastHeaders = req.headers;
    lastUrl = req.url ?? "";
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const reply = jsonRpcReply(JSON.parse(body));
      if (reply) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(reply));
      } else {
        res.writeHead(202).end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("createIdeaClient streamable-HTTP wiring", () => {
  it("connects to /stream and sends IJ_MCP_SERVER_PROJECT_PATH", async () => {
    const client = createIdeaClient(baseUrl, "/my/project");
    await client.connect();

    expect(lastUrl).toBe("/stream");
    expect(lastHeaders["ij_mcp_server_project_path"]).toBe("/my/project");

    await client.close();
  });
});
