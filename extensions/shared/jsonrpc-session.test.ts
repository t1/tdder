import { describe, expect, it, vi } from "vitest";
import { JsonRpcSession } from "./jsonrpc-session.ts";

function parseSent(sent: string[]): Array<{ id?: number; method: string; params?: unknown }> {
  return sent.map((s) => JSON.parse(s));
}

describe("JsonRpcSession", () => {
  describe("request", () => {
    it("serializes a JSON-RPC 2.0 request with incrementing ids", () => {
      const sent: string[] = [];
      const session = new JsonRpcSession((body) => { sent.push(body); });

      session.request("foo", { a: 1 });
      session.request("bar", { b: 2 });

      const messages = parseSent(sent);
      expect(messages[0]).toEqual({ jsonrpc: "2.0", id: 1, method: "foo", params: { a: 1 } });
      expect(messages[1]).toEqual({ jsonrpc: "2.0", id: 2, method: "bar", params: { b: 2 } });
    });

    it("resolves when a matching response arrives", async () => {
      const sent: string[] = [];
      const session = new JsonRpcSession((body) => { sent.push(body); });

      const promise = session.request("ping", {});
      session.handleMessage(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { pong: true } }));

      await expect(promise).resolves.toEqual({ pong: true });
    });

    it("rejects on error response", async () => {
      const session = new JsonRpcSession(() => {});

      const promise = session.request("bad", {});
      session.handleMessage(JSON.stringify({
        jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" },
      }));

      await expect(promise).rejects.toThrow("Method not found");
    });

    it("preserves error code on rejection", async () => {
      const session = new JsonRpcSession(() => {});

      const promise = session.request("bad", {});
      session.handleMessage(JSON.stringify({
        jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Invalid" },
      }));

      try {
        await promise;
      } catch (err) {
        expect((err as Error & { code: number }).code).toBe(-32600);
      }
    });

    it("rejects on timeout", async () => {
      const session = new JsonRpcSession(() => {});

      vi.useFakeTimers();
      const promise = session.request("slow", {}, 100);
      vi.advanceTimersByTime(100);

      await expect(promise).rejects.toThrow("timed out after 100ms");
      vi.useRealTimers();
    });

    it("clears timeout on successful response", async () => {
      const session = new JsonRpcSession(() => {});

      vi.useFakeTimers();
      const promise = session.request("fast", {}, 1000);
      session.handleMessage(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }));

      await expect(promise).resolves.toBe("ok");
      // Advancing past the timeout should not cause issues
      vi.advanceTimersByTime(2000);
      vi.useRealTimers();
    });

    it("rejects on async send failure", async () => {
      const session = new JsonRpcSession(async () => {
        throw new Error("send failed");
      });

      await expect(session.request("fail", {})).rejects.toThrow("send failed");
    });

    it("resolves null result as null (not undefined)", async () => {
      const session = new JsonRpcSession(() => {});

      const promise = session.request("nullish", {});
      session.handleMessage(JSON.stringify({ jsonrpc: "2.0", id: 1 }));

      await expect(promise).resolves.toBeNull();
    });
  });

  describe("notify", () => {
    it("serializes a notification without id", () => {
      const sent: string[] = [];
      const session = new JsonRpcSession((body) => { sent.push(body); });

      session.notify("notifications/initialized", {});

      const msg = parseSent(sent)[0];
      expect(msg).toEqual({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
      expect(msg).not.toHaveProperty("id");
    });
  });

  describe("handleMessage", () => {
    it("forwards notifications to onNotification callback", () => {
      const received: Array<{ method: string; params: unknown }> = [];
      const session = new JsonRpcSession(() => {}, {
        onNotification: (method, params) => { received.push({ method, params }); },
      });

      session.handleMessage(JSON.stringify({
        jsonrpc: "2.0", method: "language/status", params: { type: "Started" },
      }));

      expect(received).toEqual([{ method: "language/status", params: { type: "Started" } }]);
    });

    it("ignores notifications when no callback is set", () => {
      const session = new JsonRpcSession(() => {});

      // Should not throw
      session.handleMessage(JSON.stringify({ jsonrpc: "2.0", method: "some/event", params: {} }));
    });

    it("ignores malformed JSON", () => {
      const session = new JsonRpcSession(() => {});

      // Should not throw
      session.handleMessage("not json");
    });

    it("ignores responses with unknown id", () => {
      const session = new JsonRpcSession(() => {});

      // Should not throw
      session.handleMessage(JSON.stringify({ jsonrpc: "2.0", id: 999, result: {} }));
    });
  });

  describe("rejectAll", () => {
    it("rejects all pending requests", async () => {
      const session = new JsonRpcSession(() => {});

      const p1 = session.request("a", {});
      const p2 = session.request("b", {});

      session.rejectAll(new Error("transport closed"));

      await expect(p1).rejects.toThrow("transport closed");
      await expect(p2).rejects.toThrow("transport closed");
    });

    it("uses a default message when no reason is given", async () => {
      const session = new JsonRpcSession(() => {});

      const p = session.request("x", {});
      session.rejectAll();

      await expect(p).rejects.toThrow("JSON-RPC session closed");
    });

    it("clears timeouts on rejection", async () => {
      const session = new JsonRpcSession(() => {});

      vi.useFakeTimers();
      const p = session.request("slow", {}, 5000);
      session.rejectAll();

      await expect(p).rejects.toThrow("session closed");
      // Advancing past timeout should be safe
      vi.advanceTimersByTime(10000);
      vi.useRealTimers();
    });
  });
});
