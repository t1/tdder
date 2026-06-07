/**
 * mcp-restart must evict the jbang cache before relaunching the MCP server,
 * otherwise an outdated cached jar keeps getting picked up after a version upgrade.
 *
 * Also verifies that the missing-tool warning message no longer says "Consider
 * running /quarkus mcp-restart" (which doesn't help without a cache evict) but
 * instead mentions the jbang cache explicitly.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");

// ---------------------------------------------------------------------------
// A. handleMcpRestart runs `jbang cache clear` before relaunching
// ---------------------------------------------------------------------------

describe("handleMcpRestart evicts the jbang cache", () => {
  it("handleMcpRestart calls jbang with cache clear arguments", () => {
    const idx = src.indexOf("async function handleMcpRestart(");
    assert.ok(idx >= 0, "handleMcpRestart not found");
    const block = src.slice(idx, idx + 800);
    assert.ok(
      block.includes("cache") && block.includes("clear"),
      `handleMcpRestart must invoke "jbang cache clear" before relaunching, got:\n${block}`,
    );
  });

  it("handleMcpRestart runs cache clear before ensureClient", () => {
    const idx = src.indexOf("async function handleMcpRestart(");
    assert.ok(idx >= 0, "handleMcpRestart not found");
    const block = src.slice(idx, idx + 1200);
    const cacheIdx = block.indexOf("cache");
    const ensureIdx = block.indexOf("ensureClient");
    assert.ok(cacheIdx >= 0, "cache clear call not found in handleMcpRestart");
    assert.ok(ensureIdx >= 0, "ensureClient call not found in handleMcpRestart");
    assert.ok(
      cacheIdx < ensureIdx,
      "cache clear must come before ensureClient in handleMcpRestart",
    );
  });
});

// ---------------------------------------------------------------------------
// B. Missing-tool warning message mentions the jbang cache
// ---------------------------------------------------------------------------

describe("missing-tool warning mentions jbang cache", () => {
  it("warning message does not say 'Consider running /quarkus mcp-restart'", () => {
    assert.ok(
      !src.includes("Consider running /quarkus mcp-restart"),
      "warning must not say 'Consider running /quarkus mcp-restart' — a plain restart won't help if the jbang cache is stale",
    );
  });

  it("warning message mentions the jbang cache", () => {
    // Find the missing-tool warning notify call
    const warningIdx = src.indexOf("MCP server is missing expected tools");
    assert.ok(warningIdx >= 0, "missing-tool warning not found");
    const block = src.slice(warningIdx, warningIdx + 300);
    assert.ok(
      block.match(/jbang/i) || block.match(/cache/i),
      `missing-tool warning must mention the jbang cache, got:\n${block}`,
    );
  });
});
