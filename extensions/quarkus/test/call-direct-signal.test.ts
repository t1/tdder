/**
 * Regression test: callDirect must not expose a dead AbortSignal parameter.
 *
 * The command handler (args, ctx) receives no AbortSignal, so the signal
 * parameter on callDirect was never wired up. A dead optional parameter
 * creates false confidence that cancellation works when it doesn't.
 *
 * The fix: remove the signal parameter from callDirect entirely.
 * If cancellation is needed in the future, it should be wired end-to-end.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");

// Extract the callDirect function signature line
const callDirectIdx = src.indexOf("async function callDirect(");
assert.ok(callDirectIdx >= 0, "callDirect not found in index.ts");
// The signature spans a few lines — grab enough to see all parameters
const callDirectSig = src.slice(callDirectIdx, callDirectIdx + 300);

describe("callDirect signal parameter", () => {
  it("callDirect does not declare a signal parameter", () => {
    assert.ok(
      !callDirectSig.includes("signal"),
      "callDirect must not have a signal parameter — the command handler provides no AbortSignal to pass\n" +
      `Found: ${callDirectSig.slice(0, 200)}`,
    );
  });

  it("no call site passes a signal argument to callDirect", () => {
    // Find all lines that invoke (not declare) callDirect.
    // Invocation lines contain 'callDirect(' but not 'function callDirect('.
    const lines = src.split("\n");
    const invocationLines = lines.filter(
      (l) => l.includes("callDirect(") && !l.includes("function callDirect("),
    );
    assert.ok(invocationLines.length > 0, "expected at least one callDirect invocation");
    for (const line of invocationLines) {
      assert.ok(
        !line.includes("signal"),
        `callDirect invocation must not pass a signal argument: ${line.trim()}`,
      );
    }
  });
});
