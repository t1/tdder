import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpClient } from "@earendil-works/pi-mcp";
import { LegacySseTransport } from "../sse-transport.ts";

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

let server: Server;
let baseUrl: string;
let onSseRequest: ((res: ServerResponse) => void) | undefined;
let onPost: ((url: string, body: string, res: ServerResponse) => void) | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/sse" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      onSseRequest?.(res);
    } else if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        onPost?.(req.url ?? "", body, res);
        res.writeHead(202).end();
      });
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

describe("LegacySseTransport", () => {
  it("start() resolves when the endpoint frame arrives", async () => {
    onSseRequest = (res) => {
      res.write("event: endpoint\ndata: /msg?sessionId=abc-123\n\n");
    };

    const transport = new LegacySseTransport(baseUrl);
    await expect(transport.start()).resolves.toBeUndefined();

    await transport.close();
  });

  it("start() rejects when the server is unreachable", async () => {
    const transport = new LegacySseTransport("http://127.0.0.1:1");
    await expect(transport.start()).rejects.toThrow();
  });

  it("forwards message frames to onMessage listeners", async () => {
    onSseRequest = (res) => {
      res.write("event: endpoint\ndata: /msg?sessionId=x\n\n");
      res.write('event: message\ndata: {"jsonrpc":"2.0","id":1}\n\n');
    };

    const received: unknown[] = [];
    const transport = new LegacySseTransport(baseUrl);
    transport.onMessage((msg) => received.push(msg));
    await transport.start();

    await waitFor(() => received.length === 1);
    expect(received[0]).toEqual({ jsonrpc: "2.0", id: 1 });

    await transport.close();
  });

  it("handles a message frame split across SSE chunks", async () => {
    onSseRequest = (res) => {
      res.write("event: endpoint\ndata: /msg?sessionId=s\n\n");
      res.write('event: message\ndata: {"jsonrpc":"2.0"');
      setTimeout(() => res.write(',"id":42}\n\n'), 20);
    };

    const received: unknown[] = [];
    const transport = new LegacySseTransport(baseUrl);
    transport.onMessage((msg) => received.push(msg));
    await transport.start();

    await waitFor(() => received.length === 1);
    expect(received[0]).toEqual({ jsonrpc: "2.0", id: 42 });

    await transport.close();
  });

  it("send() POSTs the JSON-RPC message to the session URL", async () => {
    onSseRequest = (res) => {
      res.write("event: endpoint\ndata: /msg?sessionId=zzz\n\n");
    };
    const posts: Array<{ url: string; body: string }> = [];
    onPost = (url, body) => posts.push({ url, body });

    const transport = new LegacySseTransport(baseUrl);
    await transport.start();
    await transport.send({ jsonrpc: "2.0", id: 1, method: "ping" });

    expect(posts).toEqual([
      { url: "/msg?sessionId=zzz", body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' },
    ]);

    await transport.close();
  });

  it("close() emits onClose exactly once and destroys the stream", async () => {
    onSseRequest = (res) => res.write("event: endpoint\ndata: /msg?sessionId=c\n\n");

    const transport = new LegacySseTransport(baseUrl);
    let closes = 0;
    transport.onClose(() => closes++);
    await transport.start();
    expect(transport.res?.destroyed).toBe(false);

    await transport.close();
    await transport.close();
    expect(closes).toBe(1);
    expect(transport.res?.destroyed).toBe(true);
  });
});

describe("pi-mcp McpClient over LegacySseTransport", () => {
  it("completes initialize, tools/list and tools/call against a legacy SSE server", async () => {
    let sseRes: ServerResponse | undefined;
    onSseRequest = (res) => {
      sseRes = res;
      res.write("event: endpoint\ndata: /msg?sessionId=hs\n\n");
    };
    onPost = (url, body) => {
      const msg = JSON.parse(body) as { id?: number; method?: string; params?: Record<string, unknown> };
      if (msg.method === "initialize") {
        sseRes?.write(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0.0.1" } } })}\n\n`,
        );
      } else if (msg.method === "tools/list") {
        sseRes?.write(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo", description: "echoes", inputSchema: { type: "object", properties: {} } }] } })}\n\n`,
        );
      } else if (msg.method === "tools/call") {
        sseRes?.write(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(msg.params) }] } })}\n\n`,
        );
      }
      // notifications (notifications/initialized) get no response
    };

    const client = new McpClient({ name: "test", version: "0.0.1" });
    const transport = new LegacySseTransport(baseUrl);
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["echo"]);

    const result = await client.callTool("echo", { hello: "world" });
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify({ name: "echo", arguments: { hello: "world" } }) },
    ]);

    await client.close();
  });
});
