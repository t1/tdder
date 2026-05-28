import { Readable, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { FramedReader, frameMessage, LspTransport } from "../lsp-transport.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSource() {
  const readable = new Readable({ read() {} });
  return {
    readable,
    push(data: Buffer | string) {
      readable.push(typeof data === "string" ? Buffer.from(data, "utf-8") : data);
    },
  };
}

function makeSink() {
  const chunks: Buffer[] = [];
  const writable = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  return {
    writable,
    get captured(): Buffer {
      return Buffer.concat(chunks);
    },
  };
}

function makeTransport(onNotification = vi.fn()) {
  const src = makeSource();
  const sink = makeSink();
  const transport = new LspTransport(src.readable, sink.writable, onNotification);
  return { transport, src, sink, onNotification };
}

// ---------------------------------------------------------------------------
// frameMessage
// ---------------------------------------------------------------------------

describe("frameMessage", () => {
  it("produces Content-Length header followed by body", () => {
    const body = '{"jsonrpc":"2.0","id":1}';
    const frame = frameMessage(body);
    const text = frame.toString("utf-8");
    expect(text).toBe(`Content-Length: ${body.length}\r\n\r\n${body}`);
  });

  it("uses byte length, not char count, for unicode bodies", () => {
    const body = '{"v":"é"}'; // 'é' is 2 bytes in UTF-8
    const frame = frameMessage(body);
    const byteLen = Buffer.byteLength(body, "utf-8");
    expect(byteLen).toBeGreaterThan(body.length); // sanity-check: UTF-8 > char count
    const header = frame.toString("ascii", 0, frame.indexOf("\r\n\r\n"));
    expect(header).toBe(`Content-Length: ${byteLen}`);
  });
});

// ---------------------------------------------------------------------------
// FramedReader
// ---------------------------------------------------------------------------

describe("FramedReader", () => {
  it("extracts a single complete message fed in one chunk", () => {
    const body = '{"jsonrpc":"2.0","id":1,"result":{}}';
    const reader = new FramedReader();
    const msgs = reader.feed(frameMessage(body));
    expect(msgs).toEqual([body]);
  });

  it("extracts nothing when only part of the header has arrived", () => {
    const reader = new FramedReader();
    const partial = Buffer.from("Content-Le");
    expect(reader.feed(partial)).toEqual([]);
  });

  it("assembles a message split across the header/body boundary", () => {
    const body = '{"jsonrpc":"2.0","method":"$/progress","params":{}}';
    const frame = frameMessage(body);
    const split = Math.floor(frame.length / 2);
    const reader = new FramedReader();
    expect(reader.feed(frame.subarray(0, split))).toEqual([]);
    expect(reader.feed(frame.subarray(split))).toEqual([body]);
  });

  it("extracts multiple messages from one chunk", () => {
    const b1 = '{"jsonrpc":"2.0","id":1,"result":null}';
    const b2 = '{"jsonrpc":"2.0","method":"window/logMessage","params":{}}';
    const combined = Buffer.concat([frameMessage(b1), frameMessage(b2)]);
    const reader = new FramedReader();
    expect(reader.feed(combined)).toEqual([b1, b2]);
  });

  it("handles unicode message bodies correctly", () => {
    const body = '{"v":"日本語"}'; // multi-byte chars
    const reader = new FramedReader();
    const [extracted] = reader.feed(frameMessage(body));
    expect(extracted).toBe(body);
  });
});

// ---------------------------------------------------------------------------
// LspTransport — outgoing messages
// ---------------------------------------------------------------------------

describe("LspTransport.request — outgoing", () => {
  it("writes a framed JSON-RPC 2.0 request", () => {
    const { transport, sink } = makeTransport();
    transport.request("initialize", { rootUri: null });
    const written = sink.captured.toString("utf-8");
    const sep = written.indexOf("\r\n\r\n");
    const body = JSON.parse(written.slice(sep + 4)) as unknown;
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: expect.any(Number),
      method: "initialize",
      params: { rootUri: null },
    });
  });

  it("auto-increments the id across calls", () => {
    const { transport, sink } = makeTransport();
    transport.request("a", {});
    transport.request("b", {});
    const text = sink.captured.toString("utf-8");
    const bodies = text
      .split("Content-Length:")
      .slice(1)
      .map((chunk) => JSON.parse(chunk.slice(chunk.indexOf("\r\n\r\n") + 4)) as { id: number });
    expect(bodies[0].id).not.toBe(bodies[1].id);
  });
});

describe("LspTransport.notify — outgoing", () => {
  it("writes a framed JSON-RPC notification (no id field)", () => {
    const { transport, sink } = makeTransport();
    transport.notify("initialized", {});
    const text = sink.captured.toString("utf-8");
    const sep = text.indexOf("\r\n\r\n");
    const body = JSON.parse(text.slice(sep + 4)) as unknown;
    expect(body).toMatchObject({ jsonrpc: "2.0", method: "initialized", params: {} });
    expect(body).not.toHaveProperty("id");
  });
});

// ---------------------------------------------------------------------------
// LspTransport — incoming messages
// ---------------------------------------------------------------------------

describe("LspTransport.request — incoming response", () => {
  it("resolves with the result when the server replies", async () => {
    const { transport, src } = makeTransport();
    const promise = transport.request("textDocument/hover", {});
    src.push(frameMessage('{"jsonrpc":"2.0","id":1,"result":{"contents":"hover text"}}'));
    await expect(promise).resolves.toEqual({ contents: "hover text" });
  });

  it("rejects with an error when the server returns an error", async () => {
    const { transport, src } = makeTransport();
    const promise = transport.request("textDocument/rename", {});
    src.push(
      frameMessage(
        '{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"Invalid Request"}}',
      ),
    );
    await expect(promise).rejects.toThrow("Invalid Request");
  });

  it("correlates concurrent requests by id", async () => {
    const { transport, src } = makeTransport();
    const p1 = transport.request("workspace/symbol", { query: "Foo" });
    const p2 = transport.request("workspace/symbol", { query: "Bar" });
    // Reply in reverse order
    src.push(frameMessage('{"jsonrpc":"2.0","id":2,"result":["Bar"]}'));
    src.push(frameMessage('{"jsonrpc":"2.0","id":1,"result":["Foo"]}'));
    await expect(p1).resolves.toEqual(["Foo"]);
    await expect(p2).resolves.toEqual(["Bar"]);
  });
});

describe("LspTransport — notifications", () => {
  it("dispatches server notifications to the onNotification callback", () => {
    // Wrap in a real Promise so the test waits for the data event to fire,
    // regardless of whether Node.js drains the stream buffer synchronously or
    // after the next tick.
    return new Promise<void>((resolve, reject) => {
      const src = makeSource();
      const sink = makeSink();
      new LspTransport(src.readable, sink.writable, (method, params) => {
        try {
          expect(method).toBe("textDocument/publishDiagnostics");
          expect(params).toEqual({ uri: "file:///Foo.java", diagnostics: [] });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      src.push(
        frameMessage(
          '{"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":"file:///Foo.java","diagnostics":[]}}',
        ),
      );
    });
  });
});
