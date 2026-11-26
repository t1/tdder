// Vendored: pi's extension loader does not alias @earendil-works/pi-mcp, so the
// package is vendored into vendor/node_modules (see scripts/vendor-mcp-deps.mjs).
import { McpClient, StreamableHttpTransport, type InitializeResult } from "./vendor/node_modules/@earendil-works/pi-mcp/dist/index.js";

export type ToolCallResult =
  | { kind: "ok"; content: unknown }
  | { kind: "project-not-open"; openProjects: string[] };

/**
 * A thin wrapper around pi-mcp's McpClient that injects projectPath and classifies
 * responses as ToolCallResult. Usable in both production (index.ts) and
 * e2e tests without going through the full extension.
 */
export class IdeaClient {
  private readonly raw: McpClient;

  constructor(
    private readonly baseUrl: string,
    private readonly projectPath: string,
  ) {
    this.raw = new McpClient({ name: "pi-idea", version: "0.1.0" });
  }

  get rawClient(): McpClient {
    return this.raw;
  }

  connect(): Promise<InitializeResult> {
    // The IDE's streamable-HTTP endpoint; the project is pinned server-side via header.
    return this.raw.connect(
      new StreamableHttpTransport({
        url: `${this.baseUrl}/stream`,
        headers: { IJ_MCP_SERVER_PROJECT_PATH: this.projectPath },
      }),
    );
  }

  callTool(name: string, args: object = {}, timeoutMs?: number): Promise<ToolCallResult> {
    return callIdeaTool(this.raw, name, args, this.projectPath, timeoutMs);
  }

  close(): Promise<void> {
    return this.raw.close();
  }
}

export function createIdeaClient(baseUrl: string, projectPath: string): IdeaClient {
  return new IdeaClient(baseUrl, projectPath);
}

export function callIdeaTool(
  client: Pick<McpClient, "callTool">,
  name: string,
  args: object,
  projectPath: string,
  timeoutMs = 5000,
): Promise<ToolCallResult> {
  return client.callTool(name, { ...args, projectPath }, { timeoutMs }).then((result) => {
    if (result.isError) {
      const notOpen = classifyProjectNotOpen(result.content);
      if (notOpen) return notOpen;
    }
    return { kind: "ok" as const, content: result.content };
  });
}

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
