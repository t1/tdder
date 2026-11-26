// Fake quarkus-agent-mcp stdio server: newline-delimited JSON-RPC on stdin/stdout.
// Env knobs:
//   FAKE_MCP_CRASH=1  — print to stderr and exit(3) immediately (simulates jbang failure)
import { createInterface } from "node:readline";

if (process.env.FAKE_MCP_CRASH) {
  console.error("boom: fake server crashed on startup");
  process.exit(3);
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    reply(msg.id, {
      protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "fake-mcp", version: "0.0.1" },
    });
  } else if (msg.method === "tools/list") {
    reply(msg.id, {
      tools: [
        { name: "quarkus_status", description: "status", inputSchema: { type: "object", properties: {} } },
        { name: "quarkus_start", description: "start", inputSchema: { type: "object", properties: {} } },
      ],
    });
  } else if (msg.method === "tools/call") {
    reply(msg.id, { content: [{ type: "text", text: JSON.stringify(msg.params?.arguments ?? {}) }] });
  } else if (msg.id !== undefined) {
    reply(msg.id, {});
  }
  // notifications (id undefined) get no response
});
