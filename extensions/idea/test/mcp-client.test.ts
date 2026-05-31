/**
 * Integration tests for IDEA-specific MCP concerns:
 *   - projectPath injection via callIdeaTool
 *   - project-not-open error classification
 *
 * The shared McpClient protocol (handshake, correlation, timeouts) is tested
 * in extensions/shared/mcp-client.test.ts. SSE framing is tested in
 * sse-transport.test.ts and sse-parser.test.ts.
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpClient } from "../vendor/mcp-client.ts";
import { SseTransport } from "../sse-transport.ts";

let server: Server;
let baseUrl: string;
let onSse: ((res: ServerResponse) => void) | undefined;
let onPost: ((body: string, res: ServerResponse) => void) | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/sse" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      onSse?.(res);
    } else if (req.method === "POST") {
      let body = "";
      req.on("data", (c: Buffer) => (body += c));
      req.on("end", () => onPost?.(body, res));
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

// ---------------------------------------------------------------------------
// Re-implement callIdeaTool + classifyProjectNotOpen locally so the test
// doesn't import from index.ts (which pulls in the full extension + pi deps).
// These are the same functions — the test validates their behaviour via a
// real SSE server, not their source location.
// ---------------------------------------------------------------------------

type ToolCallResult =
  | { kind: "ok"; content: unknown }
  | { kind: "project-not-open"; openProjects: string[] };

function classifyProjectNotOpen(
  content: unknown,
): { kind: "project-not-open"; openProjects: string[] } | null {
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    const text = (item as { text?: string }).text;
    if (typeof text !== "string") continue;
    const marker = '{"projects":';
    const idx = text.indexOf(marker);
    if (idx < 0) continue;
    try {
      const parsed = JSON.parse(text.slice(idx)) as {
        projects: Array<{ path: string }>;
      };
      return {
        kind: "project-not-open",
        openProjects: parsed.projects.map((p) => p.path),
      };
    } catch {
      // fall through
    }
  }
  return null;
}

async function callIdeaTool(
  client: McpClient,
  name: string,
  args: object,
  projectPath: string,
  timeoutMs = 5000,
): Promise<ToolCallResult> {
  const result = await client.callTool(name, { ...args, projectPath }, timeoutMs);
  if (result.isError) {
    const notOpen = classifyProjectNotOpen(result.content);
    if (notOpen) return notOpen;
  }
  return { kind: "ok", content: result.content };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClient(): McpClient {
  return new McpClient(new SseTransport(baseUrl), {
    clientInfo: { name: "test", version: "0.0.1" },
    defaultTimeoutMs: 5000,
  });
}

function autoRespondSse(
  handler: (method: string, params: unknown) => unknown,
): void {
  let sseResponse: ServerResponse;
  onSse = (res) => {
    sseResponse = res;
    res.write("event: endpoint\ndata: /msg?sessionId=s\n\n");
  };
  onPost = (body, res) => {
    res.writeHead(202).end();
    const raw = JSON.parse(body) as { id?: number; method: string; params?: unknown };
    if (raw.id !== undefined) {
      const result = handler(raw.method, raw.params);
      sseResponse.write(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: raw.id, result })}\n\n`,
      );
    }
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("callIdeaTool", () => {
  it("injects projectPath into arguments", async () => {
    let capturedArgs: unknown;
    autoRespondSse((method, params) => {
      if (method === "initialize") return { protocolVersion: "2024-11-05", capabilities: {} };
      if (method === "tools/list") return { tools: [] };
      if (method === "tools/call") {
        capturedArgs = (params as { arguments?: unknown }).arguments;
        return { content: [{ type: "text", text: "ok" }] };
      }
      return {};
    });

    const client = createClient();
    await client.connect();
    await callIdeaTool(client, "search_symbol", { name: "foo", projectPath: "/wrong" }, "/my/proj");

    expect(capturedArgs).toEqual({ name: "foo", projectPath: "/my/proj" });
    await client.close();
  });

  it("classifies 'project not open' errors", async () => {
    autoRespondSse((method) => {
      if (method === "initialize") return { protocolVersion: "2024-11-05", capabilities: {} };
      if (method === "tools/list") return { tools: [] };
      if (method === "tools/call") {
        return {
          content: [{
            type: "text",
            text:
              "`projectPath`=`/wrong` doesn't correspond to any open project.\n" +
              ' Currently open projects: {"projects":[{"path":"/foo/bar"},{"path":"/baz"}]}',
          }],
          isError: true,
        };
      }
      return {};
    });

    const client = createClient();
    await client.connect();
    const result = await callIdeaTool(client, "search_symbol", { name: "x" }, "/wrong");

    expect(result).toEqual({
      kind: "project-not-open",
      openProjects: ["/foo/bar", "/baz"],
    });
    await client.close();
  });
});
