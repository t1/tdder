/**
 * Shared JSON-RPC 2.0 session — request/response correlation with pluggable send.
 *
 * Used by:
 *   - McpClient (MCP over SSE or stdio)
 *   - LspTransport (LSP over Content-Length-framed stdio)
 *
 * The caller provides a `send` function for outgoing serialised messages and
 * feeds incoming messages into `handleMessage()`. This module owns the id
 * counter, pending map, timeout logic, and notification dispatch.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface JsonRpcSessionOptions {
  /** Called for each incoming server notification (no id). */
  onNotification?: (method: string, params: unknown) => void;
  /** Default timeout (ms) for all requests. 0 or absent means no timeout. */
  requestTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// JsonRpcSession
// ---------------------------------------------------------------------------

export class JsonRpcSession {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly send: (body: string) => void | Promise<void>,
    private readonly options?: JsonRpcSessionOptions,
  ) {}

  /**
   * Send a JSON-RPC request and await the matching response.
   * `timeoutMs` overrides the session default (`requestTimeoutMs`).
   * 0, undefined, or absent means no timeout.
   */
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const effectiveTimeout = timeoutMs ?? this.options?.requestTimeoutMs ?? 0;

    return new Promise<unknown>((resolve, reject) => {
      const pending: Pending = { resolve, reject };

      if (effectiveTimeout > 0) {
        pending.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`JSON-RPC request '${method}' timed out after ${effectiveTimeout}ms`));
        }, effectiveTimeout);
      }

      this.pending.set(id, pending);

      const sendResult = this.send(body);
      if (sendResult && typeof (sendResult as Promise<void>).catch === "function") {
        (sendResult as Promise<void>).catch((err: unknown) => {
          if (pending.timer) clearTimeout(pending.timer);
          this.pending.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      }
    });
  }

  /** Send a JSON-RPC notification (no id, no response expected). */
  notify(method: string, params: unknown): void | Promise<void> {
    const body = JSON.stringify({ jsonrpc: "2.0", method, params });
    return this.send(body);
  }

  /**
   * Feed an incoming message (already parsed from the wire format).
   * Call this from your transport's message handler.
   */
  handleMessage(body: string): void {
    let msg: {
      id?: number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { code: number; message: string };
    };
    try {
      msg = JSON.parse(body);
    } catch {
      return; // malformed — ignore
    }

    if (msg.id !== undefined && msg.method === undefined) {
      // Response
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (p.timer) clearTimeout(p.timer);
      if (msg.error !== undefined) {
        const err = Object.assign(
          new Error(msg.error.message),
          { code: msg.error.code },
        );
        p.reject(err);
      } else {
        p.resolve(msg.result ?? null);
      }
    } else if (msg.method !== undefined) {
      // Notification
      this.options?.onNotification?.(msg.method, msg.params ?? null);
    }
  }

  /** Reject all pending requests (e.g. on close or transport error). */
  rejectAllPendingRequests(reason?: Error): void {
    const err = reason ?? new Error("JSON-RPC session closed");
    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
