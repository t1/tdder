/**
 * Tests for the missing-tool warning added after ensureClient resolves.
 *
 * When quarkus-agent-mcp upgrades and renames or removes tools that this
 * extension calls directly, the session_start handler warns the user with
 * the specific missing tool names rather than silently breaking.
 *
 * The check is driven by a REQUIRED_TOOLS constant that lists every tool
 * name the extension depends on: those in TOOL_NAME plus any called directly
 * (quarkus_app_log, quarkus_installSkills, etc.).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the string contents of a const array literal by name. */
function extractArrayLiteral(source: string, constName: string): string[] {
  const idx = source.indexOf(`const ${constName}`);
  assert.ok(idx >= 0, `${constName} not found in source`);
  // Find the '=' assignment first, then the '[' that opens the array value
  // (avoids matching '[' inside a type annotation like 'readonly string[]')
  const eqIdx = source.indexOf("=", idx);
  const start = source.indexOf("[", eqIdx);
  const end   = source.indexOf("]", start);
  const body  = source.slice(start + 1, end);
  return body
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").replace(/[,'` \r]/g, "").trim())
    .filter((s) => s.startsWith('"') || s.startsWith("'"))
    .map((s) => s.replace(/["']/g, ""))
    .filter((s) => s.length > 0);
}

/** Extract all string values from the TOOL_NAME record. */
function extractToolNameValues(source: string): string[] {
  const idx = source.indexOf("const TOOL_NAME:");
  assert.ok(idx >= 0, "TOOL_NAME not found in source");
  const end   = source.indexOf("};", idx);
  const block = source.slice(idx, end);
  const matches = [...block.matchAll(/:\s*["']([^"']+)["']/g)];
  const values  = matches.map((m) => m[1]!);
  return [...new Set(values)];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("missing-tool warning", () => {
  it("REQUIRED_TOOLS constant exists", () => {
    assert.ok(
      src.includes("const REQUIRED_TOOLS"),
      "a REQUIRED_TOOLS constant must be defined",
    );
  });

  it("REQUIRED_TOOLS contains every distinct tool in TOOL_NAME", () => {
    const required   = extractArrayLiteral(src, "REQUIRED_TOOLS");
    const toolNames  = extractToolNameValues(src);

    const missing = toolNames.filter((t) => !required.includes(t));
    assert.deepEqual(
      missing,
      [],
      `REQUIRED_TOOLS is missing these TOOL_NAME values: ${missing.join(", ")}`,
    );
  });

  it("REQUIRED_TOOLS contains quarkus_app_log (called directly for log enabling)", () => {
    const required = extractArrayLiteral(src, "REQUIRED_TOOLS");
    assert.ok(
      required.includes("quarkus_app_log"),
      'REQUIRED_TOOLS must include "quarkus_app_log"',
    );
  });

  it("REQUIRED_TOOLS contains quarkus_installSkills (called directly in handleSkills)", () => {
    const required = extractArrayLiteral(src, "REQUIRED_TOOLS");
    assert.ok(
      required.includes("quarkus_installSkills"),
      'REQUIRED_TOOLS must include "quarkus_installSkills"',
    );
  });

  it("missing-tool check runs in session_start after ensureClient resolves", () => {
    // The check must appear inside the .then() / success branch of ensureClient
    // in the session_start handler — i.e. after the client is ready.
    const sessionStartIdx = src.indexOf(`pi.on("session_start"`);
    assert.ok(sessionStartIdx >= 0, 'pi.on("session_start") not found');
    const block = src.slice(sessionStartIdx, sessionStartIdx + 1500);
    assert.ok(
      block.includes("REQUIRED_TOOLS"),
      "REQUIRED_TOOLS check must appear inside the session_start handler",
    );
    // Must appear after ensureClient resolves (i.e. inside .then or after await)
    const ensureIdx    = block.indexOf("ensureClient");
    const requiredIdx  = block.indexOf("REQUIRED_TOOLS");
    assert.ok(
      requiredIdx > ensureIdx,
      "REQUIRED_TOOLS check must come after the ensureClient call in session_start",
    );
  });

  it("warning notify is called with level 'warning' when tools are missing", () => {
    assert.ok(
      src.match(/notify\(.*warning/s),
      'ctx.ui.notify must be called with level "warning" for missing tools',
    );
    // The warning message must reference the missing tool names
    assert.ok(
      src.includes("missingTools") || src.includes("missing"),
      "the warning must include the names of missing tools",
    );
  });

  it("warning is only emitted when tools are missing (guarded by a length or filter check)", () => {
    const sessionStartIdx = src.indexOf(`pi.on("session_start"`);
    assert.ok(sessionStartIdx >= 0, 'pi.on("session_start") not found');
    const block = src.slice(sessionStartIdx, sessionStartIdx + 1500);
    // Must be conditional — either .length > 0, .length, or a filter check
    assert.ok(
      block.match(/missing.*\.length/s) || block.match(/\.length.*missing/s),
      "the warning must be gated on a non-empty missing-tools list",
    );
  });
});
