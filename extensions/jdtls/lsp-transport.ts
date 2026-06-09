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
import { JsonRpcSession } from "./vendor/jsonrpc-session.ts";

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
  private readonly session: JsonRpcSession;

  constructor(
    readable: Readable,
    private readonly writable: Writable,
    onNotification: (method: string, params: unknown) => void,
  ) {
    this.session = new JsonRpcSession(
      (body) => {
        this.writable.write(frameMessage(body));
      },
      { onNotification },
    );

    readable.on("data", (chunk: Buffer) => {
      for (const body of this.reader.feed(chunk)) {
        this.session.handleMessage(body);
      }
    });

    readable.on("error", (err: Error) => this.session.rejectAll(err));
    readable.on("close", () => this.session.rejectAll(new Error("LSP transport closed")));
  }

  /** Send a request and await the server's response. */
  request(method: string, params: unknown): Promise<unknown> {
    return this.session.request(method, params);
  }

  /** Send a notification (no id, no response expected). */
  notify(method: string, params: unknown): void {
    this.session.notify(method, params);
  }
}
