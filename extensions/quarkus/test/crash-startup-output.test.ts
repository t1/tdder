/**
 * Tests for surfacing startup-failure output in crash notifications.
 *
 * When quarkus_start fails (Maven build error, missing build goal, etc.), the
 * dev-mode process never runs, so onCrashed's DevUI diagnostics come back empty.
 * The extension must fall back to the captured quarkus_start tool output so the
 * LLM receives the actual error instead of "(unavailable)".
 *
 * These are source-inspection tests (see manual-lifecycle-awareness.test.ts):
 * index.ts is too tightly coupled to the pi extension lifecycle to execute
 * behaviorally in isolation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");

describe("startup-failure output capture", () => {
  it("QuarkusState captures the last quarkus_start output per project", () => {
    const idx = src.indexOf("interface QuarkusState");
    assert.ok(idx >= 0, "QuarkusState not found");
    const block = src.slice(idx, idx + 1500);
    assert.ok(
      block.includes("lastStartOutput"),
      `QuarkusState must capture the last quarkus_start output per project, got:\n${block}`,
    );
  });

  it("a tool_execution_end handler captures quarkus_start results into state", () => {
    const idx = src.indexOf('pi.on("tool_execution_end"');
    assert.ok(idx >= 0, "tool_execution_end hook not found");
    const block = src.slice(idx, idx + 1000);
    assert.ok(
      block.includes("quarkus_start"),
      `tool_execution_end must capture quarkus_start results, got:\n${block}`,
    );
    assert.ok(
      block.includes("lastStartOutput"),
      `tool_execution_end must store the output into state.lastStartOutput, got:\n${block}`,
    );
  });

  it("onCrashed falls back to the captured startup output when DevUI diagnostics are empty", () => {
    const idx = src.indexOf("async function onCrashed");
    assert.ok(idx >= 0, "onCrashed not found");
    const block = src.slice(idx, idx + 2000);
    assert.ok(
      block.includes("lastStartOutput"),
      `onCrashed must fall back to captured startup output when DevUI is empty, got:\n${block}`,
    );
  });

  it("the fallback message distinguishes failed-to-start from a runtime crash", () => {
    const idx = src.indexOf("async function onCrashed");
    assert.ok(idx >= 0, "onCrashed not found");
    const block = src.slice(idx, idx + 2000);
    assert.ok(
      block.includes("Quarkus dev mode failed to start"),
      `fallback message must say "failed to start" not "has crashed", got:\n${block}`,
    );
    assert.ok(
      block.includes("Quarkus dev mode has crashed"),
      `runtime-crash message must still say "has crashed", got:\n${block}`,
    );
  });
});
