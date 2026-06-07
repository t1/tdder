/**
 * Quarkus MCP client — wraps the shared McpClient with stdio transport.
 *
 * The child process lifecycle (spawn, kill, close listeners) lives here
 * because it's specific to how quarkus-agent-mcp is launched.
 */

import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { McpClient as McpClientBase, type McpTransport, type McpTool, type McpToolResult } from "./vendor/mcp-client.ts";
import { spawnSafe } from "./vendor/spawn-safe.ts";

export type { McpTool, McpToolResult };

// ---------------------------------------------------------------------------
// StdioTransport
// ---------------------------------------------------------------------------

/**
 * MCP transport over a child process's stdin/stdout.
 * Messages are newline-delimited JSON (one message per line).
 */
class StdioTransport implements McpTransport {
  onMessage: (data: string) => void = () => {};

  constructor(
    private readonly readable: NodeJS.ReadableStream,
    private readonly writable: NodeJS.WritableStream,
  ) {}

  async connect(): Promise<void> {
    const rl = createInterface({ input: this.readable });
    rl.on("line", (line) => {
      if (line.trim()) this.onMessage(line);
    });
  }

  async send(message: string): Promise<void> {
    (this.writable as NodeJS.WritableStream & { write(s: string): void }).write(message + "\n");
  }

  async close(): Promise<void> {
    (this.writable as NodeJS.WritableStream & { end(): void }).end();
  }
}

// ---------------------------------------------------------------------------
// McpClient
// ---------------------------------------------------------------------------

export class McpClient {
  private proc: ChildProcessWithoutNullStreams;
  private client: McpClientBase;
  private ready: Promise<void>;
  private closed = false;
  private closeListeners: Array<() => void> = [];

  constructor(command: string, args: string[], cwd: string, env?: Record<string, string>) {
    const { child, whenSpawnError } = spawnSafe(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc = child;

    const transport = new StdioTransport(this.proc.stdout, this.proc.stdin);
    this.client = new McpClientBase(transport, {
      clientInfo: { name: "pi-quarkus-mcp", version: "1.0.0" },
      protocolVersion: "2025-03-26",
      capabilities: { roots: { listChanged: false } },
    });

    this.proc.on("close", () => {
      this.closed = true;
      this.client.close().catch(() => {});
      for (const cb of this.closeListeners) cb();
    });

    this.ready = Promise.race([this.client.connect(), whenSpawnError]);
  }

  addCloseListener(cb: () => void): void {
    this.closeListeners.push(cb);
  }

  get tools(): McpTool[] {
    return this.client.tools;
  }

  /** Wait for the MCP handshake and tool discovery to complete. */
  async waitReady(): Promise<void> {
    await this.ready;
  }

  /** Call a tool by name with the given arguments. */
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult> {
    await this.ready;
    return this.client.callTool(name, args, undefined, signal);
  }

  /** Gracefully shut down the MCP client. */
  async close(): Promise<void> {
    if (this.closed) return;
    try {
      await this.client.request("shutdown", {}).catch(() => {});
    } catch {
      // ignore
    }
    await this.client.close();
    this.proc.kill();
    this.closed = true;
  }
}
