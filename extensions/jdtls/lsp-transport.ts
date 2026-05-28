/**
 * LSP stdio transport — Content-Length framing + JSON-RPC 2.0 correlation.
 *
 * Wire format (per LSP spec §3.6):
 *   Content-Length: <N>\r\n
 *   \r\n
 *   <N bytes of UTF-8 JSON>
 *
 * Three public exports:
 *   - frameMessage(body)   — serialise one outgoing message
 *   - FramedReader         — stateful chunk accumulator, emits complete bodies
 *   - LspTransport         — full request/response + notification layer
 */

import type { Readable, Writable } from "node:stream";

// ---------------------------------------------------------------------------
// Wire format helpers
// ---------------------------------------------------------------------------

const HEADER_SEP = Buffer.from("\r\n\r\n", "ascii");

/** Wrap a UTF-8 JSON body in the LSP Content-Length frame. */
export function frameMessage(body: string): Buffer {
  const bodyBuf = Buffer.from(body, "utf-8");
  const header = Buffer.from(`Content-Length: ${bodyBuf.length}\r\n\r\n`, "ascii");
  return Buffer.concat([header, bodyBuf]);
}

// ---------------------------------------------------------------------------
// FramedReader
// ---------------------------------------------------------------------------

/**
 * Stateful reader that accumulates raw chunks and extracts complete LSP
 * message bodies as UTF-8 strings.
 *
 * Usage:
 *   const reader = new FramedReader();
 *   readable.on('data', chunk => reader.feed(chunk).forEach(processBody));
 */
export class FramedReader {
  private buffer = Buffer.alloc(0);

  /**
   * Append `chunk` to internal buffer and return all complete message bodies
   * (zero or more) that can now be extracted.
   */
  feed(chunk: Buffer): string[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: string[] = [];
    let msg: string | null;
    while ((msg = this.tryExtract()) !== null) {
      messages.push(msg);
    }
    return messages;
  }

  private tryExtract(): string | null {
    const sepIdx = this.buffer.indexOf(HEADER_SEP);
    if (sepIdx === -1) return null;

    const header = this.buffer.subarray(0, sepIdx).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) return null;

    const bodyLen = parseInt(match[1], 10);
    const bodyStart = sepIdx + HEADER_SEP.length;
    if (this.buffer.length < bodyStart + bodyLen) return null;

    const body = this.buffer.subarray(bodyStart, bodyStart + bodyLen).toString("utf-8");
    this.buffer = this.buffer.subarray(bodyStart + bodyLen);
    return body;
  }
}

// ---------------------------------------------------------------------------
// LspTransport
// ---------------------------------------------------------------------------

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Full LSP transport over a pair of Node.js streams (typically a child process's
 * stdio).
 *
 * - `request(method, params)` → Promise that resolves/rejects when the
 *   matching response arrives.
 * - `notify(method, params)` → fire-and-forget (no id, no reply expected).
 * - Incoming server notifications (no id) are forwarded to `onNotification`.
 */
export class LspTransport {
  private readonly reader = new FramedReader();
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(
    readable: Readable,
    private readonly writable: Writable,
    private readonly onNotification: (method: string, params: unknown) => void,
  ) {
    readable.on("data", (chunk: Buffer) => {
      for (const body of this.reader.feed(chunk)) {
        this.dispatch(body);
      }
    });

    const abortPending = (err: Error) => {
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };

    readable.on("error", abortPending);
    readable.on("close", () => abortPending(new Error("LSP transport closed")));
  }

  /** Send a request and await the server's response. */
  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.writable.write(frameMessage(body));
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  /** Send a notification (no id, no response expected). */
  notify(method: string, params: unknown): void {
    const body = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.writable.write(frameMessage(body));
  }

  private dispatch(body: string): void {
    const msg = JSON.parse(body) as {
      id?: number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { code: number; message: string };
    };

    if (msg.id !== undefined && msg.method === undefined) {
      // Server → client response
      const p = this.pending.get(msg.id);
      if (!p) return; // unsolicited or duplicate — ignore
      this.pending.delete(msg.id);
      if (msg.error !== undefined) {
        const err = Object.assign(new Error(msg.error.message), { code: msg.error.code });
        p.reject(err);
      } else {
        p.resolve(msg.result ?? null);
      }
    } else if (msg.method !== undefined) {
      // Server → client notification (or server-initiated request, treated same way)
      this.onNotification(msg.method, msg.params ?? null);
    }
  }
}
