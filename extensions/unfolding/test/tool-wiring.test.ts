/**
 * Structural wiring tests for task tools (file-based polling coordination).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function loadSrc() {
  return readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
}

function blockAfter(src: string, marker: string, len = 600): string {
  const idx = src.indexOf(marker);
  assert.ok(idx >= 0, `marker not found: ${marker}`);
  return src.slice(idx, idx + len);
}

/** Extract the full tool registration block starting at marker, up to the next pi.registerTool call. */
function toolBlock(src: string, marker: string): string {
  const idx = src.indexOf(marker);
  assert.ok(idx >= 0, `marker not found: ${marker}`);
  const next = src.indexOf("pi.registerTool", idx + marker.length);
  return next >= 0 ? src.slice(idx, next) : src.slice(idx);
}

// ---------------------------------------------------------------------------
// Structural wiring
// ---------------------------------------------------------------------------

describe("structural wiring", () => {
  it("task_finished tool waits for resume after writing finished status", () => {
    const block = blockAfter(loadSrc(), 'name: "task_finished"');
    assert.ok(block.includes("taskFinished"), "must call taskFinished");
    assert.ok(block.includes("waitForResume"), "must call waitForResume");
  });

  it("task_finished returns the resume message from waitForResume", () => {
    const block = blockAfter(loadSrc(), 'name: "task_finished"');
    assert.ok(block.includes(".message"), "must return result.message from waitForResume");
  });

  it("task_block tool waits for resume after writing blocked status", () => {
    const block = blockAfter(loadSrc(), 'name: "task_block"');
    assert.ok(block.includes("taskBlock"), "must call taskBlock");
    assert.ok(block.includes("waitForResume"), "must call waitForResume");
  });

  it("task_accept tool deletes the task file", () => {
    const block = blockAfter(loadSrc(), 'name: "task_accept"');
    assert.ok(block.includes("taskAccept"), "must call taskAccept");
    // No release needed — child detects deletion via file polling
  });

  it("task_reopen tool calls taskReopen", () => {
    const block = blockAfter(loadSrc(), 'name: "task_reopen"');
    assert.ok(block.includes("taskReopen"), "must call taskReopen");
  });

  it("task_reopen tool passes resume_message with 'reopened:' prefix", () => {
    const block = blockAfter(loadSrc(), 'name: "task_reopen"');
    assert.ok(block.includes("reopened:"), "must set resume_message to 'reopened: <reason>'");
  });

  it("task_unblock tool calls taskUnblock", () => {
    const block = blockAfter(loadSrc(), 'name: "task_unblock"');
    assert.ok(block.includes("taskUnblock"), "must call taskUnblock");
  });

  it("task_unblock tool passes resume_message with 'unblocked' prefix", () => {
    const block = blockAfter(loadSrc(), 'name: "task_unblock"');
    assert.ok(block.includes("unblocked"), "must set resume_message to 'unblocked...'");
  });
});

// ---------------------------------------------------------------------------
// task_delegate wiring
// ---------------------------------------------------------------------------

describe("task_delegate wiring", () => {
  it("errors when role agent file not found", () => {
    const block = toolBlock(loadSrc(), 'name: "task_delegate"');
    assert.ok(block.includes("loadAgentSystemPrompt"), "must call loadAgentSystemPrompt");
    assert.ok(
      block.includes("throw") || block.includes("isError"),
      "must throw or return error when agent file not found",
    );
  });

  it("passes body + CHILD_FIXED_INSTRUCTION as initial message", () => {
    const block = toolBlock(loadSrc(), 'name: "task_delegate"');
    assert.ok(block.includes("CHILD_FIXED_INSTRUCTION"), "must append CHILD_FIXED_INSTRUCTION");
  });

  it("creates task after obtaining child session id", () => {
    const block = toolBlock(loadSrc(), 'name: "task_delegate"');
    assert.ok(block.includes("createTask"), "must call createTask");
    assert.ok(block.includes("session_id"), "must write session_id into task");
  });

  it("waits for child decision via waitForChildDecision", () => {
    const block = toolBlock(loadSrc(), 'name: "task_delegate"');
    assert.ok(block.includes("waitForChildDecision"), "must call waitForChildDecision");
  });

  it("accepts optional parent_slug and passes it to createTask", () => {
    const block = toolBlock(loadSrc(), 'name: "task_delegate"');
    assert.ok(block.includes("parent_slug"), "must accept and forward parent_slug");
  });
});
