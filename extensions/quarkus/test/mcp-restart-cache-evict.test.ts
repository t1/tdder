/**
 * mcp-restart must launch jbang with --fresh so it re-downloads the latest
 * quarkus-agent-mcp jar instead of serving a stale cached version.
 *
 * `jbang cache clear` was tried first but doesn't work reliably: the jar
 * re-downloaded after the clear gets cached again in the deps store, which
 * `--no-deps` doesn't touch. `--fresh` on the launch itself bypasses the cache
 * for that specific invocation and atomically replaces it, which is what we want.
 *
 * Also verifies that the missing-tool warning message mentions the jbang cache
 * so the user understands why /quarkus mcp-restart is the fix.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");

// ---------------------------------------------------------------------------
// A. startClient accepts a `fresh` flag and passes --fresh to jbang
// ---------------------------------------------------------------------------

describe("startClient supports --fresh jbang flag", () => {
  it("startClient accepts a fresh parameter", () => {
    const idx = src.indexOf("function startClient(");
    assert.ok(idx >= 0, "startClient not found");
    const sig = src.slice(idx, idx + 120);
    assert.ok(
      sig.includes("fresh"),
      `startClient must accept a 'fresh' parameter, got:\n${sig}`,
    );
  });

  it("startClient passes --fresh to jbang when fresh is true", () => {
    const idx = src.indexOf("function startClient(");
    assert.ok(idx >= 0, "startClient not found");
    const block = src.slice(idx, idx + 600);
    assert.ok(
      block.includes("--fresh"),
      `startClient must pass "--fresh" to jbang when requested, got:\n${block}`,
    );
  });
});

// ---------------------------------------------------------------------------
// B. handleMcpRestart calls startClient (or ensureClient) with fresh: true
// ---------------------------------------------------------------------------

describe("handleMcpRestart relaunches with --fresh", () => {
  it("handleMcpRestart does not spawn a separate jbang cache clear process", () => {
    const idx = src.indexOf("async function handleMcpRestart(");
    assert.ok(idx >= 0, "handleMcpRestart not found");
    const block = src.slice(idx, idx + 1200);
    assert.ok(
      !block.includes("cache clear"),
      "handleMcpRestart must not run 'jbang cache clear' — use --fresh on the launch instead",
    );
  });

  it("handleMcpRestart passes fresh: true when relaunching", () => {
    const idx = src.indexOf("async function handleMcpRestart(");
    assert.ok(idx >= 0, "handleMcpRestart not found");
    const block = src.slice(idx, idx + 1200);
    assert.ok(
      block.match(/fresh\s*:\s*true/) || block.includes("startClient") && block.includes("fresh"),
      `handleMcpRestart must pass fresh: true when relaunching, got:\n${block}`,
    );
  });
});

// ---------------------------------------------------------------------------
// C. Missing-tool warning message mentions the jbang cache
// ---------------------------------------------------------------------------

describe("missing-tool warning mentions jbang cache", () => {
  it("warning message does not say 'Consider running /quarkus mcp-restart'", () => {
    assert.ok(
      !src.includes("Consider running /quarkus mcp-restart"),
      "warning must not say 'Consider running /quarkus mcp-restart' — a plain restart won't help if the jbang cache is stale",
    );
  });

  it("warning message mentions the jbang cache", () => {
    const warningIdx = src.indexOf("MCP server is missing expected tools");
    assert.ok(warningIdx >= 0, "missing-tool warning not found");
    const block = src.slice(warningIdx, warningIdx + 300);
    assert.ok(
      block.match(/jbang/i) || block.match(/cache/i),
      `missing-tool warning must mention the jbang cache, got:\n${block}`,
    );
  });
});
