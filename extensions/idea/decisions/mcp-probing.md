# MCP probing decisions

Read `extensions/idea/AGENTS.md` before this file.

## Exploring the live MCP server

Before adding a tool, or changing a tool spec in any way where response shape or parameter details are relevant (
guidance, `collapseResult`, parameter schema), run two probes. Both are cheap (one round-trip each)
and together they give everything needed to write correct parameter schemas, guidance, and
`collapseResult` renderers.

Use `McpClient` directly via `npx tsx` — do **not** hand-roll raw `curl`/`node:http` scripts.
A raw script hit CRLF parsing issues and timed out; `McpClient` already handles all of that.

**Write probe scripts as files, not heredocs.** `npx tsx - << 'EOF'` fails with a top-level
await / CJS error. Write the script to a temporary `.mts` file inside `extensions/idea/`,
run it with `npx tsx`, then delete it.

`McpClient` takes a transport object, not a URL string. Use `SseTransport` from
`./sse-transport.ts`:

```ts
import { McpClient } from "./vendor/mcp-client.ts";
import { SseTransport } from "./sse-transport.ts";

const client = new McpClient(new SseTransport("http://127.0.0.1:64342"), {
  clientInfo: { name: "probe", version: "0.0.0" },
  protocolVersion: "2024-11-05",
  defaultTimeoutMs: 10000,
});
```

### Probe 0 — discover which projects are open

Every probe needs a valid `projectPath`. If you don't know the path, call any tool with a
fake path — the MCP returns a `project-not-open` error whose payload contains the full list:

```bash
cat > extensions/idea/probe.mts << 'EOF'
import { McpClient } from "./vendor/mcp-client.ts";
import { SseTransport } from "./sse-transport.ts";

const client = new McpClient(new SseTransport("http://127.0.0.1:64342"), {
  clientInfo: { name: "probe", version: "0.0.0" },
  protocolVersion: "2024-11-05",
  defaultTimeoutMs: 10000,
});
await client.connect();
const result = await client.callTool("get_project_modules", { projectPath: "/nonexistent" });
console.log(JSON.stringify(result, null, 2)); // { kind: "project-not-open", openProjects: [...] }
await client.close();
process.exit(0);
EOF
cd extensions/idea && npx tsx probe.mts && rm probe.mts
```

### Probe 1 — list all tools and their parameters

Run once to see what the IDE currently advertises. Reveals parameter names and which are required.

```bash
cat > extensions/idea/probe.mts << 'EOF'
import { McpClient } from "./vendor/mcp-client.ts";
import { SseTransport } from "./sse-transport.ts";

const PROJECT = "/path/to/open/project";
const client = new McpClient(new SseTransport("http://127.0.0.1:64342"), {
  clientInfo: { name: "probe", version: "0.0.0" },
  protocolVersion: "2024-11-05",
  defaultTimeoutMs: 10000,
});
await client.connect();
const tools = client.tools as Array<{
  name: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}>;
for (const t of tools) {
  const props = Object.keys(t.inputSchema?.properties ?? {}).filter(k => k !== "projectPath");
  const req = (t.inputSchema?.required ?? []).filter(k => k !== "projectPath");
  console.log(`${t.name}  params=[${props.join(", ")}]  required=[${req.join(", ")}]`);
}
await client.close();
process.exit(0);
EOF
cd extensions/idea && npx tsx probe.mts && rm probe.mts
```

### Probe 2 — call the tool and inspect the response shape

Run for each tool being added. Shows the exact JSON structure so `collapseResult` can
reference real field names, not guesses.

```bash
cat > extensions/idea/probe.mts << 'EOF'
import { McpClient } from "./vendor/mcp-client.ts";
import { SseTransport } from "./sse-transport.ts";

const PROJECT = "/path/to/open/project";
const client = new McpClient(new SseTransport("http://127.0.0.1:64342"), {
  clientInfo: { name: "probe", version: "0.0.0" },
  protocolVersion: "2024-11-05",
  defaultTimeoutMs: 10000,
});
await client.connect();
const result = await client.callTool("TOOL_NAME", { projectPath: PROJECT, /* required params */ });
console.log(JSON.stringify(result, null, 2));
await client.close();
process.exit(0);
EOF
cd extensions/idea && npx tsx probe.mts && rm probe.mts
```

Replace `TOOL_NAME` and supply any required parameters. The output is the classified
`ToolCallResult` the extension itself sees — same shape the `collapseResult` renderer receives.

**Do not write a `collapseResult` before running Probe 2.** Before assuming the IDE is
unavailable, check: run Probe 1. If it connects, the IDE is up and both probes are cheap.
If the connection is refused, ask the user to start IDEA (or run `/idea open`) and wait
before proceeding. Only if the user explicitly says to continue without it should you
register the tool without `collapseResult` and leave a TODO comment. A renderer built on an assumed response shape is
silently wrong and harder to spot than a verbose-but-correct full dump.

**Always verify new protocol-level code against the live IDE before declaring done.**
Unit tests use a hand-rolled fake server that may diverge from real-wire behaviour in
details the spec leaves ambiguous (e.g. line endings). The live IDE is the ground truth.

## `collapseResult` is a spec object, not a generic heuristic

`collapseResult` in `IdeaToolSpec` is a `CollapseSpec` with `summary` and optional
`expanded` render functions supplied by the caller (in `tool-specs.ts`), not a shared
parser that guesses structure from the raw text. Reason: response shapes differ enough
per tool that any shared heuristic would need per-tool knowledge anyway — so that
knowledge belongs in the spec where it is visible and unit-testable.

`list_directory_tree` is the clearest example of why a generic fallback fails: its
`tree` field is already a formatted text diagram; pretty-printing the outer JSON object
would be useless. Its `expanded` renderer returns `parsed.tree` directly.

The default expanded renderer (`prettyPrintContent`) is used only when the spec omits
`expanded`, which is the right choice for tools that return plain data objects.

## Confirmed response shapes

### `get_file_problems`

The response uses `errors` as the key regardless of the `errorsOnly` parameter:

```json
{ "filePath": "...", "errors": [ /* problem objects */ ] }
```

The `collapseResult` summary in `tool-specs.ts` correctly reads `p.errors.length`.

**Scope limitation:** the tool only surfaces problems from IDEA's active inspection profile.
It does **not** run TypeScript type checking. A file with real TS type errors (e.g. wrong
property on an interface) will return `errors: []`. Use TypeScript's own compiler
(`tsc --noEmit`) or vitest's type-aware transform to catch type errors.
