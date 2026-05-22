/**
 * Unit tests for McpClient close listener API.
 *
 * The original `set onClose(cb)` setter silently drops any previously
 * registered callback when called a second time. The fix is to replace
 * the setter with an `addCloseListener(cb)` method that accumulates
 * all registered callbacks and calls each one on close.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(import.meta.dirname, "../mcp-client.ts"), "utf8");

describe("McpClient close listener API", () => {
  it("exposes addCloseListener method, not a set onClose setter", () => {
    assert.ok(
      src.includes("addCloseListener("),
      "McpClient must expose addCloseListener() instead of a set onClose setter",
    );
    assert.ok(
      !src.includes("set onClose("),
      "McpClient must not use a set onClose setter — it silently overwrites previous callbacks",
    );
  });

  it("index.ts uses addCloseListener, not the onClose setter", () => {
    const indexSrc = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");
    assert.ok(
      indexSrc.includes("addCloseListener("),
      "index.ts must call addCloseListener() to register its close callback",
    );
    assert.ok(
      !indexSrc.includes(".onClose ="),
      "index.ts must not use the onClose setter",
    );
  });
});
