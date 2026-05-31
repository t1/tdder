/**
 * Shared MCP client — MCP protocol layer with pluggable transport.
 *
 * The transport strategy handles framing and delivery (SSE, stdio, etc.).
 * JSON-RPC correlation is delegated to JsonRpcSession.
 * This module owns the MCP initialize handshake and the tools/call + tools/list
 * convenience methods.
 */

import { JsonRpcSession } from "./jsonrpc-session.ts";

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

export class McpClient {
  private session: JsonRpcSession;
  private _tools: McpTool[] = [];

  constructor(
    private readonly transport: McpTransport,
    private readonly options: McpClientOptions,
  ) {
    this.session = new JsonRpcSession(
      (body) => this.transport.send(body),
    );
  }

  /** The tools discovered during `connect()`. */
  get tools(): McpTool[] {
    return this._tools;
  }

  /**
   * Connect the transport, run the MCP initialize handshake, and discover tools.
   */
  async connect(): Promise<void> {
    this.transport.onMessage = (data: string) => this.session.handleMessage(data);
    await this.transport.connect();

    await this.request("initialize", {
      protocolVersion: this.options.protocolVersion ?? "2024-11-05",
      capabilities: this.options.capabilities ?? {},
      clientInfo: this.options.clientInfo,
    });

    await this.session.notify("notifications/initialized", {});

    const result = await this.request("tools/list", {}) as { tools?: McpTool[] } | null;
    this._tools = result?.tools ?? [];
  }

  /**
   * Send a JSON-RPC request and await the response.
   * `timeoutMs` overrides the client-level default; 0 or undefined means no timeout.
   */
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const timeout = timeoutMs ?? this.options.defaultTimeoutMs;
    return this.session.request(method, params, timeout);
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
    this.session.rejectAll(new Error("client closed"));
    await this.transport.close();
  }
}
