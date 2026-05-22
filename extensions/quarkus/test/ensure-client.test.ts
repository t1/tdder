/**
 * Unit tests for the ensureClient concurrency guard.
 *
 * If two callers invoke ensureClient() concurrently while client === null,
 * the naive implementation spawns two MCP processes — one leaks.
 * The fix is to store the in-flight Promise and reuse it.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Stub that mirrors the naive (buggy) ensureClient pattern
// ---------------------------------------------------------------------------

function makeNaiveEnsureClient(startClient: () => Promise<object>) {
  let client: object | null = null;
  return async function ensureClient(): Promise<object> {
    if (!client) {
      client = await startClient();
    }
    return client;
  };
}

// ---------------------------------------------------------------------------
// Stub that mirrors the fixed ensureClient pattern (in-flight promise guard)
// ---------------------------------------------------------------------------

function makeFixedEnsureClient(startClient: () => Promise<object>) {
  let client: object | null = null;
  let starting: Promise<object> | null = null;
  return async function ensureClient(): Promise<object> {
    if (!client) {
      if (!starting) {
        starting = startClient().then((c) => { client = c; starting = null; return c; });
      }
      return starting;
    }
    return client;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ensureClient concurrency guard", () => {
  it("naive implementation calls startClient twice on concurrent access (demonstrates the bug)", async () => {
    let callCount = 0;
    const startClient = async () => { callCount++; return {}; };
    const ensureClient = makeNaiveEnsureClient(startClient);

    await Promise.all([ensureClient(), ensureClient()]);

    assert.equal(callCount, 2, "naive impl calls startClient twice — this is the bug");
  });

  it("fixed implementation calls startClient only once on concurrent access", async () => {
    let callCount = 0;
    const startClient = async () => { callCount++; return {}; };
    const ensureClient = makeFixedEnsureClient(startClient);

    await Promise.all([ensureClient(), ensureClient()]);

    assert.equal(callCount, 1, "fixed impl must call startClient exactly once");
  });

  it("fixed implementation returns the same client instance to all concurrent callers", async () => {
    const startClient = async () => ({ id: Math.random() });
    const ensureClient = makeFixedEnsureClient(startClient);

    const [a, b] = await Promise.all([ensureClient(), ensureClient()]);

    assert.strictEqual(a, b, "both callers must receive the same client instance");
  });

  it("index.ts ensureClient uses an in-flight promise guard", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");
    // Extract the ensureClient function body
    const start = src.indexOf("async function ensureClient(");
    assert.ok(start >= 0, "ensureClient not found in index.ts");
    const body = src.slice(start, start + 400);

    assert.ok(
      body.includes("starting"),
      "ensureClient must reference an in-flight promise variable (e.g. 'starting') to prevent concurrent spawns",
    );
  });
});
