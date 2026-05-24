/**
 * Unit tests for the tool-registration idempotency guard.
 *
 * The `registered` Set in index.ts tracks which MCP tool names have already
 * been passed to `pi.registerTool()`. Clearing it on mcp-restart would cause
 * duplicate `registerTool` calls for names that are already registered.
 *
 * These tests verify:
 *   1. The guard works correctly when intact.
 *   2. The mcp-restart handler in index.ts does NOT call registered.clear().
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Minimal stub that mirrors the registerMcpTools logic from index.ts
// ---------------------------------------------------------------------------

interface StubTool { name: string }

function makeRegistrar(registered: Set<string>, registerTool: (name: string) => void) {
  return function registerMcpTools(tools: StubTool[]): void {
    for (const tool of tools) {
      if (registered.has(tool.name)) continue;
      registered.add(tool.name);
      registerTool(tool.name);
    }
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerMcpTools idempotency guard", () => {
  it("registers each tool exactly once on first call", () => {
    const registered = new Set<string>();
    const calls: string[] = [];
    const registerMcpTools = makeRegistrar(registered, (name) => calls.push(name));

    registerMcpTools([{ name: "quarkus_start" }, { name: "quarkus_stop" }]);

    assert.deepEqual(calls, ["quarkus_start", "quarkus_stop"]);
  });

  it("does NOT register already-known tools on a second call (guard works)", () => {
    const registered = new Set<string>();
    const calls: string[] = [];
    const registerMcpTools = makeRegistrar(registered, (name) => calls.push(name));

    registerMcpTools([{ name: "quarkus_start" }, { name: "quarkus_stop" }]);
    calls.length = 0; // reset counter

    registerMcpTools([{ name: "quarkus_start" }, { name: "quarkus_stop" }]);

    assert.deepEqual(calls, [], "no re-registration expected when guard is intact");
  });

  it("mcp-restart handler does not call registeredToolNames.clear()", () => {
    // Read the source and assert the clear() call is absent from the handleMcpRestart function.
    const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");
    const mcpRestartBlock = src.slice(src.indexOf("async function handleMcpRestart("));
    const afterBlock = mcpRestartBlock.indexOf("\n  async function ");
    const block = afterBlock > 0 ? mcpRestartBlock.slice(0, afterBlock) : mcpRestartBlock.slice(0, 500);

    assert.ok(
      !block.includes("registeredToolNames.clear()"),
      "handleMcpRestart must not call registeredToolNames.clear() — it causes duplicate pi.registerTool() calls",
    );
  });
});
