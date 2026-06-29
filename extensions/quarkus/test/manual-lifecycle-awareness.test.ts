/**
 * Tests for surfacing externally observed lifecycle changes to the LLM.
 *
 * Ordinary manual start/stop/restart transitions should be buffered and injected
 * on the next turn instead of spamming the chat immediately. Crashes stay
 * immediate via onCrashed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(import.meta.dirname, "../index.ts"), "utf8");

describe("lifecycle buffering state", () => {
  it("QuarkusState tracks pending lifecycle changes and suppression windows", () => {
    const idx = src.indexOf("interface QuarkusState");
    assert.ok(idx >= 0, "QuarkusState not found");
    const block = src.slice(idx, idx + 1000);
    assert.ok(block.includes("pendingLifecycleChanges"), `QuarkusState must buffer lifecycle changes, got:\n${block}`);
    assert.ok(block.includes("suppressedLifecycleChanges"), `QuarkusState must track suppression windows, got:\n${block}`);
  });

  it("defines helpers to remember, record, and drain lifecycle changes", () => {
    assert.ok(src.includes("function rememberAgentLifecycleChange"), "rememberAgentLifecycleChange must exist");
    assert.ok(src.includes("function recordLifecycleChange"), "recordLifecycleChange must exist");
    assert.ok(src.includes("function drainLifecycleSummary"), "drainLifecycleSummary must exist");
  });
});

describe("buffered manual lifecycle updates", () => {
  it("before_agent_start injects buffered lifecycle changes into the next turn", () => {
    const summaryIdx = src.indexOf("const lifecycleSummary = drainLifecycleSummary(ctx.cwd);");
    assert.ok(summaryIdx >= 0, "lifecycle before_agent_start hook not found");
    const idx = src.lastIndexOf('pi.on("before_agent_start"', summaryIdx);
    assert.ok(idx >= 0, "before_agent_start hook not found");
    const block = src.slice(idx, idx + 700);
    assert.ok(block.includes("drainLifecycleSummary"), `before_agent_start must drain pending lifecycle updates, got:\n${block}`);
    assert.ok(block.includes("Context update: Quarkus service state changed since the last turn"), `before_agent_start must mention lifecycle changes, got:\n${block}`);
  });

  it("refreshAppStatus records lifecycle changes for non-crash transitions", () => {
    const idx = src.indexOf("async function refreshAppStatus");
    assert.ok(idx >= 0, "refreshAppStatus not found");
    const block = src.slice(idx, idx + 1400);
    assert.ok(block.includes("recordLifecycleChange"), `refreshAppStatus must buffer ordinary lifecycle changes, got:\n${block}`);
  });

  it("refreshAppStatus still handles crashes immediately", () => {
    const idx = src.indexOf("async function refreshAppStatus");
    assert.ok(idx >= 0, "refreshAppStatus not found");
    const block = src.slice(idx, idx + 1400);
    assert.ok(block.includes("await onCrashed(dir)"), `refreshAppStatus must still report crashes immediately, got:\n${block}`);
  });
});

describe("agent-initiated lifecycle suppression", () => {
  it("marks quarkus start/stop/restart calls as agent-initiated", () => {
    const idx = src.indexOf('pi.on("tool_call"');
    assert.ok(idx >= 0, "tool_call hook not found");
    const block = src.slice(idx, idx + 900);
    assert.ok(block.includes('event.toolName === "quarkus_start"'), `tool_call hook must suppress quarkus_start, got:\n${block}`);
    assert.ok(block.includes('event.toolName === "quarkus_stop"'), `tool_call hook must suppress quarkus_stop, got:\n${block}`);
    assert.ok(block.includes('event.toolName === "quarkus_restart"'), `tool_call hook must suppress quarkus_restart, got:\n${block}`);
    assert.ok(block.includes("rememberAgentLifecycleChange(project)"), `tool_call hook must remember the affected project, got:\n${block}`);
  });

  it("restart command explicitly remembers lifecycle changes", () => {
    const idx = src.indexOf("async function handleDirectSubcommand");
    assert.ok(idx >= 0, "handleDirectSubcommand not found");
    const block = src.slice(idx, idx + 1400);
    assert.ok(block.includes('if (sub === "restart") rememberAgentLifecycleChange(project);'), `restart should suppress its own lifecycle transitions, got:\n${block}`);
  });
});

describe("restart is preserved as meaningful information", () => {
  it("summarizeLifecycleObservation has a restarted case", () => {
    const idx = src.indexOf("function summarizeLifecycleObservation");
    assert.ok(idx >= 0, "summarizeLifecycleObservation not found");
    const block = src.slice(idx, idx + 700);
    assert.ok(block.includes("restarted"), `restart should survive lifecycle coalescing, got:\n${block}`);
  });
});
