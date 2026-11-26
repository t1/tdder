/**
 * Characterization tests for the quarkus McpClient wrapper.
 *
 * These pin the behavior of mcp-client.ts while its internals move from the
 * vendored JSON-RPC client to pi-mcp's McpClient + StdioTransport. Run against
 * the old implementation first (must pass), then against the new one (must
 * still pass).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { McpClient, McpStartupError } from "../mcp-client.ts";

const FAKE_SERVER = resolve(import.meta.dirname, "fixtures/fake-mcp-server.mjs");
const NODE = process.execPath;

function fakeClient(env?: Record<string, string>): McpClient {
  return new McpClient(NODE, [FAKE_SERVER], process.cwd(), env);
}

describe("McpClient over pi-mcp stdio", () => {
  it("waitReady resolves after handshake and tools discovers the server's tools", async () => {
    const c = fakeClient();
    await c.waitReady();
    assert.deepEqual(
      c.tools.map((t) => t.name),
      ["quarkus_status", "quarkus_start"],
    );
    await c.close();
  });

  it("callTool forwards arguments and returns the result", async () => {
    const c = fakeClient();
    await c.waitReady();
    const result = await c.callTool("quarkus_status", { projectDir: "/x" });
    assert.equal(result.isError, undefined);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    assert.equal(JSON.parse(text).projectDir, "/x");
    await c.close();
  });

  it("callTool forwards an AbortSignal", async () => {
    const c = fakeClient();
    await c.waitReady();
    const ac = new AbortController();
    const result = await c.callTool("quarkus_status", {}, ac.signal);
    assert.ok(result);
    await c.close();
  });

  it("rejects waitReady with McpStartupError carrying stderr when the process dies during startup", async () => {
    const c = fakeClient({ FAKE_MCP_CRASH: "1" });
    await assert.rejects(c.waitReady(), (err: unknown) => {
      assert.ok(err instanceof McpStartupError, `expected McpStartupError, got ${err}`);
      assert.match((err as McpStartupError).stderr, /boom: fake server crashed/);
      return true;
    });
  });

  it("fires every addCloseListener callback on close", async () => {
    const c = fakeClient();
    await c.waitReady();
    let a = 0;
    let b = 0;
    c.addCloseListener(() => a++);
    c.addCloseListener(() => b++);
    await c.close();
    assert.equal(a, 1);
    assert.equal(b, 1);
  });
});
