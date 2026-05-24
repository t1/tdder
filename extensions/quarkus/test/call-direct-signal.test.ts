/**
 * Regression test: callMcpTool must not expose a dead AbortSignal parameter.
 *
 * The command handler (args, ctx) receives no AbortSignal, so a signal
 * parameter on callMcpTool would never be wired up. A dead optional parameter
 * creates false confidence that cancellation works when it doesn't.
 *
 * The fix: callMcpTool has no signal parameter.
 * If cancellation is needed in the future, it should be wired end-to-end.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");

// Extract the callMcpTool function signature line
const callMcpToolIdx = src.indexOf("async function callMcpTool(");
assert.ok(callMcpToolIdx >= 0, "callMcpTool not found in index.ts");
// The signature spans a few lines — grab enough to see all parameters
const callMcpToolSig = src.slice(callMcpToolIdx, callMcpToolIdx + 300);

describe("callMcpTool signal parameter", () => {
  it("callMcpTool does not declare a signal parameter", () => {
    assert.ok(
      !callMcpToolSig.includes("signal"),
      "callMcpTool must not have a signal parameter — the command handler provides no AbortSignal to pass\n" +
      `Found: ${callMcpToolSig.slice(0, 200)}`,
    );
  });

  it("no call site passes a signal argument to callMcpTool", () => {
    // Find all lines that invoke (not declare) callMcpTool.
    // Invocation lines contain 'callMcpTool(' but not 'function callMcpTool('.
    const lines = src.split("\n");
    const invocationLines = lines.filter(
      (l) => l.includes("callMcpTool(") && !l.includes("function callMcpTool("),
    );
    assert.ok(invocationLines.length > 0, "expected at least one callMcpTool invocation");
    for (const line of invocationLines) {
      assert.ok(
        !line.includes("signal"),
        `callMcpTool invocation must not pass a signal argument: ${line.trim()}`,
      );
    }
  });
});
