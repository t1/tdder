/**
 * Structural wiring tests for task tools (file-based polling coordination).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// ---------------------------------------------------------------------------
// Structural wiring
// ---------------------------------------------------------------------------

describe("structural wiring", () => {
  it("task_finished tool waits for resume after writing finished status", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_finished"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 500);
    assert.ok(block.includes("taskFinished"), "must call taskFinished");
    assert.ok(block.includes("waitForResume"), "must call waitForResume");
  });

  it("task_block tool waits for resume after writing blocked status", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_block"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 500);
    assert.ok(block.includes("taskBlock"), "must call taskBlock");
    assert.ok(block.includes("waitForResume"), "must call waitForResume");
  });

  it("task_accept tool deletes the task file", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_accept"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 500);
    assert.ok(block.includes("taskAccept"), "must call taskAccept");
    // No release needed — child detects deletion via file polling
  });

  it("task_reopen tool sets status to in_progress", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_reopen"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 500);
    assert.ok(block.includes("taskReopen"), "must call taskReopen");
  });

  it("task_unblock tool sets status to in_progress", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_unblock"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 500);
    assert.ok(block.includes("taskUnblock"), "must call taskUnblock");
  });
});

// ---------------------------------------------------------------------------
// task_delegate wiring
// ---------------------------------------------------------------------------

describe("task_delegate wiring", () => {
  it("errors when role agent file not found", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_delegate"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 1500);
    assert.ok(block.includes("loadAgentSystemPrompt"), "must call loadAgentSystemPrompt");
    assert.ok(
      block.includes("throw") || block.includes("isError"),
      "must throw or return error when agent file not found"
    );
  });

  it("creates task file and writes session_id after session starts", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_delegate"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 1500);
    assert.ok(block.includes("createTask"), "must call createTask");
    assert.ok(block.includes("session_id"), "must write session_id to task");
  });

  it("passes body + CHILD_FIXED_INSTRUCTION as initial message", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const idx = src.indexOf('name: "task_delegate"');
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 1500);
    assert.ok(block.includes("CHILD_FIXED_INSTRUCTION"), "must append CHILD_FIXED_INSTRUCTION");
  });
});
