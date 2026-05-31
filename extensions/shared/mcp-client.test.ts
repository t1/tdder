import { describe, expect, it, vi, beforeEach } from "vitest";
import { McpClient, type McpTransport } from "./mcp-client.ts";

// ---------------------------------------------------------------------------
// Fake transport
// ---------------------------------------------------------------------------

class FakeTransport implements McpTransport {
  onMessage: (data: string) => void = () => {};
  sent: string[] = [];
  connected = false;
  closed = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async send(message: string): Promise<void> {
    this.sent.push(message);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Simulate a server response arriving for the given request id. */
  respond(id: number, result: unknown): void {
    this.onMessage(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  /** Simulate a server error response. */
  respondError(id: number, code: number, message: string): void {
    this.onMessage(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
  }

  /** Auto-respond to every sent message with the given result factory. */
  autoRespond(resultFactory: (method: string, params: unknown) => unknown): void {
    const originalSend = this.send.bind(this);
    this.send = async (message: string) => {
      await originalSend(message);
      const parsed = JSON.parse(message) as { id?: number; method: string; params?: unknown };
      if (parsed.id !== undefined) {
        const result = resultFactory(parsed.method, parsed.params);
        this.respond(parsed.id, result);
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultOptions() {
  return {
    clientInfo: { name: "test-client", version: "0.0.1" },
  };
}

function parseSent(transport: FakeTransport): Array<{ id?: number; method: string; params?: unknown }> {
  return transport.sent.map((s) => JSON.parse(s));
}

function autoRespondDefaults(transport: FakeTransport): void {
  transport.autoRespond((method) => {
    if (method === "initialize") return { protocolVersion: "2024-11-05", capabilities: {} };
    if (method === "tools/list") return { tools: [] };
    return {};
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("McpClient", () => {
  let transport: FakeTransport;

  beforeEach(() => {
    transport = new FakeTransport();
  });

  describe("connect", () => {
    it("connects the transport", async () => {
      autoRespondDefaults(transport);
      const client = new McpClient(transport, defaultOptions());

      await client.connect();

      expect(transport.connected).toBe(true);
    });

    it("sends initialize then notifications/initialized then tools/list", async () => {
      autoRespondDefaults(transport);
      const client = new McpClient(transport, defaultOptions());

      await client.connect();

      const messages = parseSent(transport);
      expect(messages.map((m) => m.method)).toEqual([
        "initialize",
        "notifications/initialized",
        "tools/list",
      ]);
    });

    it("sends the configured clientInfo and protocolVersion", async () => {
      autoRespondDefaults(transport);
      const client = new McpClient(transport, {
        clientInfo: { name: "my-client", version: "1.2.3" },
        protocolVersion: "2025-03-26",
      });

      await client.connect();

      const initMsg = parseSent(transport)[0];
      expect(initMsg.params).toEqual({
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "my-client", version: "1.2.3" },
      });
    });

    it("defaults protocolVersion to 2024-11-05", async () => {
      autoRespondDefaults(transport);
      const client = new McpClient(transport, defaultOptions());

      await client.connect();

      const initMsg = parseSent(transport)[0];
      expect((initMsg.params as Record<string, unknown>).protocolVersion).toBe("2024-11-05");
    });

    it("populates tools from the tools/list response", async () => {
      const tools = [
        { name: "search_symbol", description: "Find symbols", inputSchema: { type: "object" } },
        { name: "get_file_problems", description: "Get problems", inputSchema: { type: "object" } },
      ];
      transport.autoRespond((method) => {
        if (method === "initialize") return { protocolVersion: "2024-11-05", capabilities: {} };
        if (method === "tools/list") return { tools };
        return {};
      });
      const client = new McpClient(transport, defaultOptions());

      await client.connect();

      expect(client.tools).toEqual(tools);
    });

    it("notifications/initialized is a notification (no id)", async () => {
      autoRespondDefaults(transport);
      const client = new McpClient(transport, defaultOptions());

      await client.connect();

      const notif = parseSent(transport).find((m) => m.method === "notifications/initialized");
      expect(notif?.id).toBeUndefined();
    });
  });

  describe("request", () => {
    it("correlates response by id", async () => {
      transport.autoRespond((method) => {
        if (method === "initialize") return { protocolVersion: "2024-11-05", capabilities: {} };
        if (method === "tools/list") return { tools: [] };
        return { echo: method };
      });
      const client = new McpClient(transport, defaultOptions());
      await client.connect();

      const result = await client.request("ping", {});
      expect(result).toEqual({ echo: "ping" });
    });

    it("rejects on server error response", async () => {
      autoRespondDefaults(transport);
      const client = new McpClient(transport, defaultOptions());
      await client.connect();

      // Send a request and deliver an error response via onMessage
      const promise = client.request("bad_method", {});
      // Find the id of the request we just sent
      const lastMsg = parseSent(transport).at(-1)!;
      transport.respondError(lastMsg.id!, -32601, "Method not found");

      await expect(promise).rejects.toThrow(
        "MCP error -32601: Method not found",
      );
    });

    it("rejects on timeout", async () => {
      autoRespondDefaults(transport);
      const client = new McpClient(transport, defaultOptions());
      await client.connect();

      // Don't auto-respond — let it timeout
      transport.send = async (message: string) => {
        transport.sent.push(message);
      };

      vi.useFakeTimers();
      const promise = client.request("slow_method", {}, 100);
      vi.advanceTimersByTime(100);

      await expect(promise).rejects.toThrow("timed out after 100ms");
      vi.useRealTimers();
    });

    it("uses defaultTimeoutMs when no per-request timeout", async () => {
      transport.autoRespond((method) => {
        if (method === "initialize") return { protocolVersion: "2024-11-05", capabilities: {} };
        if (method === "tools/list") return { tools: [] };
        return {};
      });
      const client = new McpClient(transport, {
        ...defaultOptions(),
        defaultTimeoutMs: 200,
      });
      await client.connect();

      // Don't auto-respond
      transport.send = async (message: string) => {
        transport.sent.push(message);
      };

      vi.useFakeTimers();
      const promise = client.request("slow", {});
      vi.advanceTimersByTime(200);

      await expect(promise).rejects.toThrow("timed out after 200ms");
      vi.useRealTimers();
    });
  });

  describe("callTool", () => {
    it("sends tools/call with name and arguments", async () => {
      transport.autoRespond((method) => {
        if (method === "initialize") return { protocolVersion: "2024-11-05", capabilities: {} };
        if (method === "tools/list") return { tools: [] };
        if (method === "tools/call") return { content: [{ type: "text", text: "result" }] };
        return {};
      });
      const client = new McpClient(transport, defaultOptions());
      await client.connect();

      const result = await client.callTool("my_tool", { query: "foo" });

      const callMsg = parseSent(transport).find((m) => m.method === "tools/call");
      expect(callMsg?.params).toEqual({
        name: "my_tool",
        arguments: { query: "foo" },
      });
      expect(result).toEqual({ content: [{ type: "text", text: "result" }] });
    });

    it("returns empty content array for null server result", async () => {
      transport.autoRespond((method) => {
        if (method === "initialize") return { protocolVersion: "2024-11-05", capabilities: {} };
        if (method === "tools/list") return { tools: [] };
        if (method === "tools/call") return null;
        return {};
      });
      const client = new McpClient(transport, defaultOptions());
      await client.connect();

      const result = await client.callTool("some_tool", {});

      expect(result).toEqual({ content: [] });
    });

    it("throws on aborted signal", async () => {
      autoRespondDefaults(transport);
      const client = new McpClient(transport, defaultOptions());
      await client.connect();

      const controller = new AbortController();
      controller.abort();

      await expect(client.callTool("tool", {}, undefined, controller.signal))
        .rejects.toThrow("Cancelled");
    });
  });

  describe("close", () => {
    it("rejects all pending requests", async () => {
      autoRespondDefaults(transport);
      const client = new McpClient(transport, defaultOptions());
      await client.connect();

      // Don't auto-respond — leave request pending
      transport.send = async (message: string) => {
        transport.sent.push(message);
      };

      const promise = client.request("hanging", {});
      await client.close();

      await expect(promise).rejects.toThrow("client closed");
    });

    it("closes the transport", async () => {
      autoRespondDefaults(transport);
      const client = new McpClient(transport, defaultOptions());
      await client.connect();

      await client.close();

      expect(transport.closed).toBe(true);
    });
  });

  describe("malformed messages", () => {
    it("ignores non-JSON messages", async () => {
      autoRespondDefaults(transport);
      const client = new McpClient(transport, defaultOptions());
      await client.connect();

      // Should not throw
      transport.onMessage("not json at all");
    });

    it("ignores notifications (messages without id)", async () => {
      autoRespondDefaults(transport);
      const client = new McpClient(transport, defaultOptions());
      await client.connect();

      // Should not throw
      transport.onMessage(JSON.stringify({ jsonrpc: "2.0", method: "some/notification", params: {} }));
    });

    it("ignores responses with unknown id", async () => {
      autoRespondDefaults(transport);
      const client = new McpClient(transport, defaultOptions());
      await client.connect();

      // Should not throw
      transport.respond(999, { unexpected: true });
    });
  });
});
