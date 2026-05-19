/**
 * MCP stdio client - JSON-RPC 2.0 over a child process stdin/stdout.
 *
 * Handles the MCP initialize handshake, tool discovery, and tool calls.
 * All communication is newline-delimited JSON (one message per line).
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export class McpClient {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private ready: Promise<void>;
  private _tools: McpTool[] = [];
  private closed = false;
  private _onClose?: () => void;

  constructor(command: string, args: string[], cwd: string, env?: Record<string, string>) {
    this.proc = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const rl = createInterface({ input: this.proc.stdout });

    rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            p.resolve(msg.result);
          }
        }
      }
      // Notifications (no id) are ignored for now
    });

    this.proc.on("close", () => {
      this.closed = true;
      // Reject any pending requests
      for (const [, p] of this.pending) {
        p.reject(new Error("MCP server process closed"));
      }
      this.pending.clear();
      this._onClose?.();
    });

    this.ready = this._initialize();
  }

  set onClose(cb: () => void) {
    this._onClose = cb;
  }

  get tools(): McpTool[] {
    return this._tools;
  }

  private send(msg: JsonRpcRequest | JsonRpcNotification): void {
    if (this.closed) return;
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  private request<T>(method: string, params?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.closed) {
        reject(new Error("MCP client is closed"));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private async _initialize(): Promise<void> {
    // Send initialize request
    await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: { roots: { listChanged: false } },
      clientInfo: { name: "pi-quarkus-mcp", version: "1.0.0" },
    });

    // Send initialized notification (no id, no response expected)
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });

    // Discover tools
    const result = await this.request<{ tools: McpTool[] }>("tools/list", {});
    this._tools = result?.tools ?? [];
  }

  /** Wait for the MCP handshake and tool discovery to complete. */
  async waitReady(): Promise<void> {
    await this.ready;
  }

  /** Call a tool by name with the given arguments. */
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult> {
    await this.ready;

    if (signal?.aborted) {
      throw new Error("Cancelled");
    }

    const result = await this.request<McpToolResult>("tools/call", {
      name,
      arguments: args,
    });

    return result ?? { content: [] };
  }

  /** Gracefully shut down the MCP client. */
  async close(): Promise<void> {
    if (this.closed) return;
    try {
      await this.request("shutdown", {}).catch(() => {});
    } catch {
      // ignore
    }
    this.proc.stdin.end();
    this.proc.kill();
    this.closed = true;
  }
}
