import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpClient } from "../mcp-client.ts";

let server: Server;
let baseUrl: string;
let onSse: ((res: ServerResponse) => void) | undefined;
let onPost: ((req: IncomingMessage, body: string, res: ServerResponse) => void) | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/sse" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      onSse?.(res);
    } else if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => onPost?.(req, body, res));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("McpClient", () => {
  it("sendRequest resolves with the response matching its id", async () => {
    let sseResponse: ServerResponse;
    onSse = (res) => {
      sseResponse = res;
      res.write("event: endpoint\ndata: /msg?sessionId=t1\n\n");
    };
    onPost = (_req, body, res) => {
      res.writeHead(202).end();
      const incoming = JSON.parse(body) as { id: number; method: string };
      // Echo back a response with the same id
      sseResponse.write(
        `event: message\ndata: {"jsonrpc":"2.0","id":${incoming.id},"result":{"echo":"${incoming.method}"}}\n\n`,
      );
    };

    const client = new McpClient(baseUrl, "/some/project");
    await client.openConnection();
    const response = await client.sendRequest("ping", {});
    expect(response).toEqual({
      kind: "response",
      id: response.kind === "response" ? response.id : -1,
      result: { echo: "ping" },
    });

    await client.close();
  });

  it("connect performs the initialize handshake", async () => {
    let sseResponse: ServerResponse;
    const received: Array<{ method: string; hasId: boolean }> = [];
    onSse = (res) => {
      sseResponse = res;
      res.write("event: endpoint\ndata: /msg?sessionId=h\n\n");
    };
    onPost = (_req, body, res) => {
      res.writeHead(202).end();
      const raw = JSON.parse(body) as { id?: number; method: string };
      received.push({ method: raw.method, hasId: raw.id !== undefined });
      if (raw.id !== undefined) {
        sseResponse.write(
          `event: message\ndata: {"jsonrpc":"2.0","id":${raw.id},"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"fake","version":"0"}}}\n\n`,
        );
      }
    };

    const client = new McpClient(baseUrl, "/proj");
    await client.connect();

    expect(received).toEqual([
      { method: "initialize", hasId: true },
      { method: "notifications/initialized", hasId: false },
    ]);

    await client.close();
  });
  it("listTools returns the server's tools array", async () => {
    let sseResponse: ServerResponse;
    onSse = (res) => {
      sseResponse = res;
      res.write("event: endpoint\ndata: /msg?sessionId=lt\n\n");
    };
    onPost = (_req, body, res) => {
      res.writeHead(202).end();
      const raw = JSON.parse(body) as { id?: number; method: string };
      if (raw.id === undefined) return;
      let result: unknown = {};
      if (raw.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: {} };
      else if (raw.method === "tools/list") {
        result = {
          tools: [
            { name: "search_symbol", description: "Find a symbol", inputSchema: { type: "object" } },
            { name: "get_file_problems", description: "Get problems", inputSchema: { type: "object" } },
          ],
        };
      }
      sseResponse.write(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: raw.id, result })}\n\n`,
      );
    };

    const client = new McpClient(baseUrl, "/proj");
    await client.connect();
    const tools = await client.listTools();

    expect(tools).toEqual([
      { name: "search_symbol", description: "Find a symbol", inputSchema: { type: "object" } },
      { name: "get_file_problems", description: "Get problems", inputSchema: { type: "object" } },
    ]);

    await client.close();
  });
  it("callTool injects projectPath into arguments and overrides caller-provided values", async () => {
    let sseResponse: ServerResponse;
    let capturedArgs: unknown;
    onSse = (res) => {
      sseResponse = res;
      res.write("event: endpoint\ndata: /msg?sessionId=ct\n\n");
    };
    onPost = (_req, body, res) => {
      res.writeHead(202).end();
      const raw = JSON.parse(body) as {
        id?: number;
        method: string;
        params?: { arguments?: unknown };
      };
      if (raw.id === undefined) return;
      if (raw.method === "tools/call") capturedArgs = raw.params?.arguments;
      let result: unknown = {};
      if (raw.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: {} };
      else if (raw.method === "tools/call") result = { content: [{ type: "text", text: "ok" }] };
      sseResponse.write(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: raw.id, result })}\n\n`,
      );
    };

    const client = new McpClient(baseUrl, "/my/proj");
    await client.connect();
    // Caller tries to pass a wrong projectPath — should be overridden.
    await client.callTool("search_symbol", { name: "foo", projectPath: "/wrong" });

    expect(capturedArgs).toEqual({ name: "foo", projectPath: "/my/proj" });

    await client.close();
  });
  it("callTool classifies 'project not open' errors", async () => {
    let sseResponse: ServerResponse;
    onSse = (res) => {
      sseResponse = res;
      res.write("event: endpoint\ndata: /msg?sessionId=err\n\n");
    };
    onPost = (_req, body, res) => {
      res.writeHead(202).end();
      const raw = JSON.parse(body) as { id?: number; method: string };
      if (raw.id === undefined) return;
      let result: unknown = {};
      if (raw.method === "initialize") {
        result = { protocolVersion: "2024-11-05", capabilities: {} };
      } else if (raw.method === "tools/call") {
        result = {
          content: [
            {
              type: "text",
              text:
                "`projectPath`=`/wrong` doesn't correspond to any open project.\n" +
                ' Currently open projects: {"projects":[{"path":"/foo/bar"},{"path":"/baz"}]}',
            },
          ],
          isError: true,
        };
      }
      sseResponse.write(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: raw.id, result })}\n\n`,
      );
    };

    const client = new McpClient(baseUrl, "/wrong");
    await client.connect();
    const result = await client.callTool("search_symbol", { name: "x" });

    expect(result).toEqual({
      kind: "project-not-open",
      openProjects: ["/foo/bar", "/baz"],
    });

    await client.close();
  });
});
