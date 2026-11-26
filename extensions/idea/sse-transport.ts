/**
 * Legacy SSE transport for MCP servers that expose the pre-Streamable-HTTP
 * protocol (GET /sse stream + POST to a session-specific /message URL), like
 * the JetBrains MCP Server plugin. Implements pi-mcp's McpTransport so the
 * pi-mcp McpClient can talk to it.
 */
import { Agent, request, type ClientRequest, type IncomingMessage } from "node:http";
import type {
  JsonRpcMessage,
  McpTransport,
  McpTransportCloseListener,
  McpTransportErrorListener,
  McpTransportMessageListener,
  McpTransportSendOptions,
} from "@earendil-works/pi-mcp";
import { parseFrames } from "./sse-parser.ts";

const START_TIMEOUT_MS = 5000;

export class LegacySseTransport implements McpTransport {
  private sessionUrl = "";
  private req?: ClientRequest;
  private _res?: IncomingMessage;
  private readonly agent = new Agent({ keepAlive: true });
  private readonly messageListeners = new Set<McpTransportMessageListener>();
  private readonly errorListeners = new Set<McpTransportErrorListener>();
  private readonly closeListeners = new Set<McpTransportCloseListener>();
  private closeEmitted = false;

  /** The active SSE response stream, or undefined before start() or after close(). */
  get res(): IncomingMessage | undefined {
    return this._res;
  }

  constructor(private baseUrl: string) {}

  onMessage(listener: McpTransportMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: McpTransportErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onClose(listener: McpTransportCloseListener): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SSE connect timed out after ${START_TIMEOUT_MS}ms — no endpoint event received`));
      }, START_TIMEOUT_MS);

      this.req = request(`${this.baseUrl}/sse`, { method: "GET", agent: this.agent });
      this.req.on("error", (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
      this.req.on("response", (res: IncomingMessage) => {
        this._res = res;
        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const { frames, remainder } = parseFrames(buffer);
          buffer = remainder;
          for (const frame of frames) {
            if (frame.event === "endpoint") {
              this.sessionUrl = frame.data;
              clearTimeout(timer);
              resolve();
            } else if (frame.event === "message") {
              try {
                const message = JSON.parse(frame.data) as JsonRpcMessage;
                for (const l of this.messageListeners) l(message);
              } catch (err) {
                for (const l of this.errorListeners) l(err as Error);
              }
            }
          }
        });
        res.on("error", (err: Error) => {
          clearTimeout(timer);
          for (const l of this.errorListeners) l(err);
        });
        res.on("close", () => this.emitClose());
      });
      this.req.end();
    });
  }

  async send(message: JsonRpcMessage, _options?: McpTransportSendOptions): Promise<void> {
    const body = JSON.stringify(message);
    return new Promise((resolve, reject) => {
      const req = request(`${this.baseUrl}${this.sessionUrl}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body).toString(),
        },
        agent: this.agent,
      });
      req.on("error", reject);
      req.on("response", () => resolve());
      req.end(body);
    });
  }

  async close(): Promise<void> {
    this._res?.destroy();
    this.req?.destroy();
    this.agent.destroy();
    this.emitClose();
  }

  private emitClose(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    for (const l of this.closeListeners) l();
  }
}
