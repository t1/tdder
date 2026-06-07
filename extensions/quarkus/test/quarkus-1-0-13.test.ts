/**
 * Tests for quarkus-agent-mcp 1.0.13 compatibility and new features.
 *
 * Changes in 1.0.13:
 *   - quarkus_start now BLOCKS until the app reaches RUNNING/CRASHED/timeout
 *     (was fire-and-forget; LLM had to poll quarkus_status 5-13 times per start)
 *   - quarkus_skills now accepts comma-separated queries
 *     (multiple extensions can be fetched in one call)
 *
 * Impact on the extension:
 *   A. TOOL_GUIDELINES["quarkus_skills"] must tell the LLM to batch queries.
 *   B. The startup-polling machinery (startupBeganAt, startupLogLines, logPoller,
 *      onEnteringStarting, onLeavingStarting, refreshLogWidget) is no longer
 *      needed for normal start: quarkus_start already waits.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");

// ---------------------------------------------------------------------------
// A. quarkus_skills guideline — comma-separated batch queries
// ---------------------------------------------------------------------------

describe("quarkus_skills guideline mentions comma-separated batch queries", () => {
  it("TOOL_GUIDELINES[quarkus_skills] mentions comma-separated queries", () => {
    const guidelinesIdx = src.indexOf("TOOL_GUIDELINES");
    assert.ok(guidelinesIdx >= 0, "TOOL_GUIDELINES not found");
    const block = src.slice(guidelinesIdx, guidelinesIdx + 6000);
    const skillsIdx = block.indexOf("quarkus_skills:");
    assert.ok(skillsIdx >= 0, 'TOOL_GUIDELINES must have a "quarkus_skills" entry');
    const skillsBlock = block.slice(skillsIdx, skillsIdx + 600);
    assert.ok(
      skillsBlock.match(/comma.{0,30}separat/i) || skillsBlock.match(/separat.{0,30}comma/i),
      `TOOL_GUIDELINES["quarkus_skills"] must mention comma-separated queries, got:\n${skillsBlock}`,
    );
  });

  it("TOOL_GUIDELINES[quarkus_skills] shows how to batch multiple extensions in one call", () => {
    const guidelinesIdx = src.indexOf("TOOL_GUIDELINES");
    const block = src.slice(guidelinesIdx, guidelinesIdx + 6000);
    const skillsIdx = block.indexOf("quarkus_skills:");
    const skillsBlock = block.slice(skillsIdx, skillsIdx + 600);
    // Must mention "multiple" or give a concrete example like panache,rest or similar
    assert.ok(
      skillsBlock.match(/multiple/i) ||
      skillsBlock.match(/\w+,\w+/) ||
      skillsBlock.match(/single call/i) ||
      skillsBlock.match(/one call/i),
      `TOOL_GUIDELINES["quarkus_skills"] must explain batching multiple extensions, got:\n${skillsBlock}`,
    );
  });
});

// ---------------------------------------------------------------------------
// B. Startup-polling machinery removed — quarkus_start now blocks
// ---------------------------------------------------------------------------

describe("startup polling machinery removed after quarkus_start blocking change", () => {
  it("startupBeganAt field no longer exists in QuarkusState", () => {
    assert.ok(
      !src.includes("startupBeganAt"),
      "startupBeganAt tracking is no longer needed: quarkus_start blocks until the app is up",
    );
  });

  it("startupLogLines field no longer exists in QuarkusState", () => {
    assert.ok(
      !src.includes("startupLogLines"),
      "startupLogLines tracking is no longer needed: quarkus_start blocks until the app is up",
    );
  });

  it("logPoller field no longer exists in QuarkusState", () => {
    assert.ok(
      !src.includes("logPoller"),
      "logPoller is no longer needed: quarkus_start blocks so there is nothing to poll during startup",
    );
  });

  it("onEnteringStarting function no longer exists", () => {
    assert.ok(
      !src.includes("onEnteringStarting"),
      "onEnteringStarting is no longer needed after quarkus_start became blocking",
    );
  });

  it("onLeavingStarting function no longer exists", () => {
    assert.ok(
      !src.includes("onLeavingStarting"),
      "onLeavingStarting is no longer needed after quarkus_start became blocking",
    );
  });

  it("refreshLogWidget function no longer exists", () => {
    assert.ok(
      !src.includes("refreshLogWidget"),
      "refreshLogWidget is no longer needed: no log widget to poll during blocking quarkus_start",
    );
  });
});
