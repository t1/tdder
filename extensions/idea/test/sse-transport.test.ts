import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SseTransport } from "../sse-transport.ts";

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
let onPost: ((url: string, body: string) => void) | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/sse" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      onSseRequest?.(res);
    } else if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        onPost?.(req.url ?? "", body);
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

describe("SseTransport", () => {
  it("captures the session endpoint URL from the endpoint frame", async () => {
    onSseRequest = (res) => {
      res.write("event: endpoint\ndata: /msg?sessionId=abc-123\n\n");
    };

    const transport = new SseTransport(baseUrl);
    await transport.connect();

    expect(transport.sessionUrl).toBe("/msg?sessionId=abc-123");

    await transport.close();
  });

  it("forwards message frame data to the onMessage handler", async () => {
    onSseRequest = (res) => {
      res.write("event: endpoint\ndata: /msg?sessionId=x\n\n");
      res.write('event: message\ndata: {"jsonrpc":"2.0","id":1}\n\n');
    };

    const received: string[] = [];
    const transport = new SseTransport(baseUrl);
    transport.onMessage = (data) => received.push(data);
    await transport.connect();

    await waitFor(() => received.length === 1);
    expect(received[0]).toBe('{"jsonrpc":"2.0","id":1}');

    await transport.close();
  });
  it("POSTs a request body to the session URL", async () => {
    onSseRequest = (res) => {
      res.write("event: endpoint\ndata: /msg?sessionId=zzz\n\n");
    };
    const posts: Array<{ url: string; body: string }> = [];
    onPost = (url, body) => posts.push({ url, body });

    const transport = new SseTransport(baseUrl);
    await transport.connect();
    await transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}');

    expect(posts).toEqual([
      { url: "/msg?sessionId=zzz", body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' },
    ]);

    await transport.close();
  });
  it("close() destroys the client-side response stream", async () => {
    onSseRequest = (res) => res.write("event: endpoint\ndata: /msg?sessionId=res-destroyed\n\n");

    const transport = new SseTransport(baseUrl);
    await transport.connect();
    expect(transport.res?.destroyed).toBe(false);

    await transport.close();
    expect(transport.res?.destroyed).toBe(true);
  });

  it("handles a message frame split across SSE chunks", async () => {
    onSseRequest = (res) => {
      res.write("event: endpoint\ndata: /msg?sessionId=s\n\n");
      res.write('event: message\ndata: {"jsonrpc":"2.0"');
      setTimeout(() => res.write(',"id":42}\n\n'), 20);
    };

    const received: string[] = [];
    const transport = new SseTransport(baseUrl);
    transport.onMessage = (data) => received.push(data);
    await transport.connect();

    await waitFor(() => received.length === 1);
    expect(received[0]).toBe('{"jsonrpc":"2.0","id":42}');

    await transport.close();
  });
});
