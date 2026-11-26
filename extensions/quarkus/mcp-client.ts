/**
 * Quarkus MCP client — wraps pi-mcp's McpClient with a StdioTransport.
 *
 * The child process lifecycle (spawn, kill, stderr capture, close listeners)
 * lives here because it's specific to how quarkus-agent-mcp is launched via jbang.
 */

// Vendored: pi's extension loader does not alias @earendil-works/pi-mcp, so the
// package is vendored into vendor/node_modules (see scripts/vendor-mcp-deps.mjs).
import {
  McpClient as PiMcpClient,
  StdioTransport,
  type CallToolResult,
  type Tool,
} from "./vendor/node_modules/@earendil-works/pi-mcp/dist/index.js";

export type { CallToolResult as McpToolResult, Tool as McpTool };

/** Error thrown when the MCP child process exits before the handshake completes. */
export class McpStartupError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "McpStartupError";
  }
}

export class McpClient {
  private readonly transport: StdioTransport;
  private readonly client: PiMcpClient;
  private readonly ready: Promise<void>;
  private closeListeners: Array<() => void> = [];
  private listenersFired = false;
  private toolCache: Tool[] = [];

  constructor(command: string, args: string[], cwd: string, env?: Record<string, string>) {
    const transport = new StdioTransport({
      command,
      args,
      cwd,
      env,
    });
    const client = new PiMcpClient({
      name: "pi-quarkus-mcp",
      version: "1.0.0",
    });
    this.transport = transport;
    this.client = client;

    // Reject the ready promise with a rich error when the connection drops
    // before the handshake completes (e.g. jbang fails to resolve the alias).
    let settled = false;
    const whenDropped = new Promise<never>((_resolve, reject) => {
      client.onClose(() => {
        this.fireCloseListeners();
        if (!settled) {
          settled = true;
          reject(
            new McpStartupError(
              "quarkus-agent-mcp exited unexpectedly before the handshake completed",
              null,
              transport.stderr.trim(),
            ),
          );
        }
      });
    });

    const whenConnected = (async () => {
      await client.connect(transport);
      this.toolCache = await client.listTools();
      settled = true;
    })();

    this.ready = Promise.race([whenConnected, whenDropped]);
  }

  addCloseListener(cb: () => void): void {
    this.closeListeners.push(cb);
  }

  get tools(): Tool[] {
    return this.toolCache;
  }

  /** Wait for the MCP handshake and tool discovery to complete. */
  async waitReady(): Promise<void> {
    await this.ready;
  }

  /** Call a tool by name with the given arguments. */
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult> {
    await this.ready;
    return this.client.callTool(name, args, { signal });
  }

  /** Gracefully shut down the MCP client. */
  async close(): Promise<void> {
    await this.client.close();
    this.fireCloseListeners();
  }

  private fireCloseListeners(): void {
    if (this.listenersFired) return;
    this.listenersFired = true;
    for (const cb of this.closeListeners) cb();
  }
}
