import {
  parseMessage,
  serializeNotification,
  serializeRequest,
  type Message,
} from "./jsonrpc.ts";
import { SseTransport } from "./sse-transport.ts";

export class McpClient {
  private transport: SseTransport;
  private nextId = 1;
  private pending = new Map<number, (msg: Message) => void>();

  constructor(baseUrl: string, private projectPath: string) {
    this.transport = new SseTransport(baseUrl);
  }

  async openConnection(): Promise<void> {
    this.transport.onMessage = (data) => {
      const msg = parseMessage(data);
      if (msg.kind === "response") {
        const handler = this.pending.get(msg.id);
        if (handler) {
          this.pending.delete(msg.id);
          handler(msg);
        }
      }
    };
    await this.transport.connect();
  }

  async sendRequest(method: string, params: unknown): Promise<Message> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.transport.send(serializeRequest(method, params, id));
    });
  }

  async connect(): Promise<void> {
    await this.openConnection();
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pi-idea", version: "0.1.0" },
    });
    await this.transport.send(serializeNotification("notifications/initialized", {}));
  }

  async callTool(name: string, args: object): Promise<ToolCallResult> {
    const response = await this.sendRequest("tools/call", {
      name,
      arguments: { ...args, projectPath: this.projectPath },
    });
    if (response.kind !== "response" || !response.result) {
      return { kind: "ok", content: null };
    }
    const result = response.result as { content?: unknown; isError?: boolean };
    if (result.isError) {
      const notOpen = classifyProjectNotOpen(result.content);
      if (notOpen) return notOpen;
    }
    return { kind: "ok", content: result.content };
  }

  async listTools(): Promise<unknown[]> {
    const response = await this.sendRequest("tools/list", {});
    if (response.kind !== "response" || !response.result) return [];
    const result = response.result as { tools?: unknown[] };
    return result.tools ?? [];
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

export type ToolCallResult =
  | { kind: "ok"; content: unknown }
  | { kind: "project-not-open"; openProjects: string[] };

function classifyProjectNotOpen(
  content: unknown,
): { kind: "project-not-open"; openProjects: string[] } | null {
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    const text = (item as { text?: string }).text;
    if (typeof text !== "string") continue;
    const marker = '{"projects":';
    const idx = text.indexOf(marker);
    if (idx < 0) continue;
    try {
      const parsed = JSON.parse(text.slice(idx)) as {
        projects: Array<{ path: string }>;
      };
      return {
        kind: "project-not-open",
        openProjects: parsed.projects.map((p) => p.path),
      };
    } catch {
      // fall through to next item
    }
  }
  return null;
}
