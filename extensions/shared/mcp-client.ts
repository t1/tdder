/**
 * Shared MCP client — JSON-RPC 2.0 session layer with pluggable transport.
 *
 * The transport strategy handles framing and delivery (SSE, stdio, etc.).
 * This module owns request correlation, the MCP initialize handshake,
 * and the tools/call + tools/list convenience methods.
 */

// ---------------------------------------------------------------------------
// Transport strategy
// ---------------------------------------------------------------------------

/**
 * Pluggable transport for sending and receiving JSON-RPC messages.
 *
 * Implementations:
 *   - SseTransport  (idea extension) — HTTP SSE stream
 *   - StdioTransport (quarkus extension) — child-process stdin/stdout
 *
 * Contract:
 *   1. Set `onMessage` before calling `connect()`.
 *   2. `connect()` performs any async handshake (SSE endpoint, readline setup).
 *   3. `send(body)` delivers a serialised JSON-RPC message.
 *   4. The transport calls `onMessage(data)` for each complete incoming message.
 *   5. `close()` tears down the connection; after close, no more `onMessage` calls.
 */
export interface McpTransport {
  /** Called by the transport for each incoming message (set before `connect`). */
  onMessage: (data: string) => void;
  /** Establish the connection (async handshake, stream setup, etc.). */
  connect(): Promise<void>;
  /** Send a serialised JSON-RPC message to the server. */
  send(message: string): Promise<void>;
  /** Tear down the connection. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface McpClientOptions {
  clientInfo: { name: string; version: string };
  protocolVersion?: string;
  capabilities?: object;
  defaultTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// McpClient
// ---------------------------------------------------------------------------

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class McpClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private _tools: McpTool[] = [];

  constructor(
    private readonly transport: McpTransport,
    private readonly options: McpClientOptions,
  ) {}

  /** The tools discovered during `connect()`. */
  get tools(): McpTool[] {
    return this._tools;
  }

  /**
   * Connect the transport, run the MCP initialize handshake, and discover tools.
   */
  async connect(): Promise<void> {
    this.transport.onMessage = (data: string) => this.handleMessage(data);
    await this.transport.connect();

    await this.request("initialize", {
      protocolVersion: this.options.protocolVersion ?? "2024-11-05",
      capabilities: this.options.capabilities ?? {},
      clientInfo: this.options.clientInfo,
    });

    await this.notify("notifications/initialized", {});

    const result = await this.request("tools/list", {}) as { tools?: McpTool[] } | null;
    this._tools = result?.tools ?? [];
  }

  /**
   * Send a JSON-RPC request and await the response.
   * `timeoutMs` overrides the client-level default; 0 or undefined means no timeout.
   */
  async request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    return new Promise<unknown>((resolve, reject) => {
      const timeout = timeoutMs ?? this.options.defaultTimeoutMs;
      const pending: Pending = { resolve, reject };

      if (timeout && timeout > 0) {
        pending.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`MCP request '${method}' timed out after ${timeout}ms`));
        }, timeout);
      }

      this.pending.set(id, pending);

      this.transport.send(body).catch((err: unknown) => {
        if (pending.timer) clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  /** Send a JSON-RPC notification (no id, no response expected). */
  async notify(method: string, params: unknown): Promise<void> {
    const body = JSON.stringify({ jsonrpc: "2.0", method, params });
    await this.transport.send(body);
  }

  /** Call an MCP tool by name. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<McpToolResult> {
    if (signal?.aborted) throw new Error("Cancelled");

    const result = await this.request(
      "tools/call",
      { name, arguments: args },
      timeoutMs,
    ) as McpToolResult | null;

    return result ?? { content: [] };
  }

  /** Discover available tools (re-fetch from server). */
  async listTools(): Promise<McpTool[]> {
    const result = await this.request("tools/list", {}) as { tools?: McpTool[] } | null;
    this._tools = result?.tools ?? [];
    return this._tools;
  }

  /** Gracefully close: reject all pending requests, then close the transport. */
  async close(): Promise<void> {
    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error("client closed"));
    }
    this.pending.clear();
    await this.transport.close();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private handleMessage(data: string): void {
    let msg: { id?: number; error?: { code: number; message: string }; result?: unknown };
    try {
      msg = JSON.parse(data);
    } catch {
      return; // malformed — ignore
    }

    if (msg.id === undefined) return; // notification — ignored for now

    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);

    if (p.timer) clearTimeout(p.timer);

    if (msg.error) {
      p.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
    } else {
      p.resolve(msg.result ?? null);
    }
  }
}
