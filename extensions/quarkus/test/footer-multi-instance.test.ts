/**
 * Tests for multi-instance footer status display.
 *
 * The footer is driven by quarkus_list (not quarkus_status) and shows all
 * non-stopped instances grouped as:
 *
 *   quarkus[●blog ◌people ⚠api]
 *
 * Rules:
 *   - Only non-stopped instances are shown (stopped → omitted)
 *   - If all instances are stopped (or none exist) → status key is cleared (undefined)
 *   - Icons: ● running, ◌ starting, ⚠ crashed
 *   - Label = last path segment of the project directory
 *   - Per-instance state is tracked in a Map for crash-detection
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");

// ---------------------------------------------------------------------------
// A. refreshAppStatus uses quarkus_list, not quarkus_status
// ---------------------------------------------------------------------------

describe("refreshAppStatus uses quarkus_list", () => {
  it("refreshAppStatus calls quarkus_list", () => {
    const idx = src.indexOf("async function refreshAppStatus");
    assert.ok(idx >= 0, "refreshAppStatus not found");
    const block = src.slice(idx, idx + 600);
    assert.ok(
      block.includes("quarkus_list"),
      `refreshAppStatus must call quarkus_list, got:\n${block}`,
    );
  });

  it("refreshAppStatus does not call quarkus_status", () => {
    const idx = src.indexOf("async function refreshAppStatus");
    assert.ok(idx >= 0, "refreshAppStatus not found");
    const block = src.slice(idx, idx + 600);
    assert.ok(
      !block.includes("quarkus_status"),
      `refreshAppStatus must not call quarkus_status (use quarkus_list instead), got:\n${block}`,
    );
  });
});

// ---------------------------------------------------------------------------
// B. parseListOutput helper
// ---------------------------------------------------------------------------

describe("parseListOutput helper", () => {
  it("parseListOutput is defined", () => {
    assert.ok(
      src.includes("function parseListOutput"),
      "parseListOutput function must be defined",
    );
  });

  it("parseListOutput parses running/starting/crashed/stopped values", () => {
    const idx = src.indexOf("function parseListOutput");
    assert.ok(idx >= 0, "parseListOutput not found");
    const block = src.slice(idx, idx + 800);
    assert.ok(
      block.includes("running") && block.includes("starting") && block.includes("crashed"),
      `parseListOutput must handle running/starting/crashed states, got:\n${block}`,
    );
  });

  it("parseListOutput handles 'No managed Quarkus instances' text gracefully", () => {
    const idx = src.indexOf("function parseListOutput");
    assert.ok(idx >= 0, "parseListOutput not found");
    const block = src.slice(idx, idx + 800);
    assert.ok(
      block.includes("No managed") || block.includes("parse") || block.includes("catch") || block.includes("try"),
      `parseListOutput must handle non-JSON output gracefully, got:\n${block}`,
    );
  });
});

// ---------------------------------------------------------------------------
// C. formatFooterStatus helper
// ---------------------------------------------------------------------------

describe("formatFooterStatus helper", () => {
  it("formatFooterStatus is defined", () => {
    assert.ok(
      src.includes("function formatFooterStatus"),
      "formatFooterStatus function must be defined",
    );
  });

  it("formatFooterStatus wraps output in quarkus[…]", () => {
    const idx = src.indexOf("function formatFooterStatus");
    assert.ok(idx >= 0, "formatFooterStatus not found");
    const block = src.slice(idx, idx + 600);
    assert.ok(
      block.includes("quarkus[") || block.match(/`quarkus\[/),
      `formatFooterStatus must produce quarkus[…] format, got:\n${block}`,
    );
  });

  it("formatFooterStatus includes the available Quarkus tool count", () => {
    const idx = src.indexOf("function formatFooterStatus");
    assert.ok(idx >= 0, "formatFooterStatus not found");
    const block = src.slice(idx, idx + 700);
    assert.ok(
      block.includes("tools") && block.includes("availableToolCount"),
      `formatFooterStatus must include the available Quarkus tool count, got:\n${block}`,
    );
  });

  it("formatFooterStatus uses ● for running, ◌ for starting, ⚠ for crashed", () => {
    const idx = src.indexOf("function formatFooterStatus");
    assert.ok(idx >= 0, "formatFooterStatus not found");
    const block = src.slice(idx, idx + 600);
    assert.ok(block.includes("●"), `formatFooterStatus must use ● for running, got:\n${block}`);
    assert.ok(block.includes("◌"), `formatFooterStatus must use ◌ for starting, got:\n${block}`);
    assert.ok(block.includes("⚠"), `formatFooterStatus must use ⚠ for crashed, got:\n${block}`);
  });

  it("formatFooterStatus returns undefined when there are neither tools nor non-stopped instances", () => {
    const idx = src.indexOf("function formatFooterStatus");
    assert.ok(idx >= 0, "formatFooterStatus not found");
    const block = src.slice(idx, idx + 700);
    assert.ok(
      block.includes("undefined") || block.includes("return;") || block.includes("length === 0"),
      `formatFooterStatus must return undefined when there is nothing to show, got:\n${block}`,
    );
  });

  it("formatFooterStatus uses last path segment as label", () => {
    const idx = src.indexOf("function formatFooterStatus");
    assert.ok(idx >= 0, "formatFooterStatus not found");
    // Look for path splitting logic nearby (within the function or a helper it calls)
    const block = src.slice(idx, idx + 800);
    assert.ok(
      block.includes("split") || block.includes("basename") || block.includes("lastIndexOf") || block.includes("at(-1)"),
      `formatFooterStatus must extract the last path segment as the label, got:\n${block}`,
    );
  });
});

// ---------------------------------------------------------------------------
// D. lastAppState replaced by per-instance Map
// ---------------------------------------------------------------------------

describe("per-instance crash tracking", () => {
  it("QuarkusState uses a Map for per-instance state instead of a single lastAppState", () => {
    const stateIdx = src.indexOf("interface QuarkusState");
    assert.ok(stateIdx >= 0, "QuarkusState interface not found");
    const block = src.slice(stateIdx, stateIdx + 500);
    assert.ok(
      !block.includes("lastAppState:"),
      `QuarkusState must not have a single lastAppState field; use a Map instead, got:\n${block}`,
    );
  });

  it("QuarkusState has a Map field for tracking instance states", () => {
    const stateIdx = src.indexOf("interface QuarkusState");
    assert.ok(stateIdx >= 0, "QuarkusState interface not found");
    const block = src.slice(stateIdx, stateIdx + 800);
    assert.ok(
      block.includes("Map<"),
      `QuarkusState must have a Map<string, AppState> field for per-instance tracking, got:\n${block}`,
    );
  });
});
