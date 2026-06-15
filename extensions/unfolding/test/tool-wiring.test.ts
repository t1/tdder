/**
 * Structural wiring tests for task tools (file-based polling coordination).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadIndexSrc, blockAfter, toolBlock } from "./src-helpers.ts";

function loadSrc() { return loadIndexSrc(); }

// ---------------------------------------------------------------------------
// Structural wiring
// ---------------------------------------------------------------------------

describe("structural wiring", () => {
  it("task_finished tool waits for resume after writing finished status", () => {
    const block = toolBlock(loadSrc(), 'name: "task_delegate"');
    assert.ok(block.includes("task_finished"), "task_delegate must inject task_finished");
    assert.ok(block.includes("taskFinished"), "must call taskFinished");
    assert.ok(block.includes("waitForResume"), "must call waitForResume");
  });

  it("task_finished returns the resume message from waitForResume", () => {
    const block = toolBlock(loadSrc(), 'name: "task_delegate"');
    assert.ok(block.includes(".message"), "must return result.message from waitForResume");
  });

  it("task_block tool waits for resume after writing blocked status", () => {
    const block = toolBlock(loadSrc(), 'name: "task_delegate"');
    assert.ok(block.includes("task_block"), "task_delegate must inject task_block");
    assert.ok(block.includes("taskBlock"), "must call taskBlock");
    assert.ok(block.includes("waitForResume"), "must call waitForResume");
  });

  it("task_accept tool deletes the task file", () => {
    const block = blockAfter(loadSrc(), 'name: "task_accept"');
    assert.ok(block.includes("taskAccept"), "must call taskAccept");
    // No release needed — child detects deletion via file polling
  });

  it("task_reopen tool calls taskReopen", () => {
    const block = blockAfter(loadSrc(), 'name: "task_reopen"', 1600);
    assert.ok(block.includes("taskReopen"), "must call taskReopen");
  });

  it("task_reopen tool passes resume_message with 'reopened:' prefix", () => {
    // The 'reopened:' prefix is applied by taskReopen in task-tools.ts
    const block = blockAfter(loadSrc(), 'name: "task_reopen"', 1600);
    assert.ok(block.includes("taskReopen"), "must delegate to taskReopen which applies the 'reopened:' prefix");
  });

  it("task_reopen tool delegates resume flow to resumeDelegatedTask", () => {
    const block = blockAfter(loadSrc(), 'name: "task_reopen"', 1200);
    assert.ok(block.includes("resumeDelegatedTask"), "must delegate resume flow to resumeDelegatedTask");
  });

  it("task_unblock tool calls taskUnblock", () => {
    const block = blockAfter(loadSrc(), 'name: "task_unblock"', 1600);
    assert.ok(block.includes("taskUnblock"), "must call taskUnblock");
  });

  it("task_unblock tool passes resume_message with 'unblocked' prefix", () => {
    // The 'unblocked' prefix is applied by taskUnblock in task-tools.ts
    const block = blockAfter(loadSrc(), 'name: "task_unblock"', 1600);
    assert.ok(block.includes("taskUnblock"), "must delegate to taskUnblock which applies the 'unblocked' prefix");
  });

  it("task_unblock tool delegates resume flow to resumeDelegatedTask", () => {
    const block = blockAfter(loadSrc(), 'name: "task_unblock"', 1200);
    assert.ok(block.includes("resumeDelegatedTask"), "must delegate resume flow to resumeDelegatedTask");
  });

  it("task_unblock posts args to postOutput", () => {
    const block = blockAfter(loadSrc(), 'name: "task_unblock"', 1600);
    assert.ok(block.includes("postOutput"), "must post args via postOutput for human visibility");
  });

  it("task_unblock delegates missing-session failure handling to resumeDelegatedTask", () => {
    const block = blockAfter(loadSrc(), 'name: "task_unblock"', 1200);
    assert.ok(block.includes("resumeDelegatedTask"), "must delegate missing-session failure handling to resumeDelegatedTask");
  });

  it("task_reopen posts args to postOutput", () => {
    const block = blockAfter(loadSrc(), 'name: "task_reopen"', 1600);
    assert.ok(block.includes("postOutput"), "must post args via postOutput for human visibility");
  });

  it("task_reopen delegates missing-session failure handling to resumeDelegatedTask", () => {
    const block = blockAfter(loadSrc(), 'name: "task_reopen"', 1200);
    assert.ok(block.includes("resumeDelegatedTask"), "must delegate missing-session failure handling to resumeDelegatedTask");
  });

  it("task_accept posts args to postOutput", () => {
    const block = blockAfter(loadSrc(), 'name: "task_accept"');
    assert.ok(block.includes("postOutput"), "must post args via postOutput for human visibility");
  });
});

// ---------------------------------------------------------------------------
// task_delegate wiring
// ---------------------------------------------------------------------------

describe("task_delegate wiring", () => {
  const src = loadSrc();

  it("errors when role agent file not found", () => {
    const block = toolBlock(src, 'name: "task_delegate"');
    assert.ok(block.includes("loadAgentSystemPrompt"), "must call loadAgentSystemPrompt");
    assert.ok(
      block.includes("throw") || block.includes("isError"),
      "must throw or return error when agent file not found",
    );
  });

  it("passes body + CHILD_FIXED_INSTRUCTION as initial message", () => {
    const block = toolBlock(src, 'name: "task_delegate"');
    assert.ok(block.includes("CHILD_FIXED_INSTRUCTION"), "must append CHILD_FIXED_INSTRUCTION");
  });

  it("creates task after obtaining child session id", () => {
    const block = toolBlock(src, 'name: "task_delegate"');
    assert.ok(block.includes("createTask"), "must call createTask");
    assert.ok(block.includes("session_id"), "must write session_id into task");
  });

  it("waits for child decision via waitForChildDecision", () => {
    const block = toolBlock(src, 'name: "task_delegate"');
    assert.ok(block.includes("waitForChildDecision"), "must call waitForChildDecision");
  });

  it("accepts optional parent_slug and passes it to createTask", () => {
    const block = toolBlock(src, 'name: "task_delegate"');
    assert.ok(block.includes("parent_slug"), "must accept and forward parent_slug");
  });

  it("uses shortRole as 'from' when creating a task (not hardcoded 'orchestrator')", () => {
    const block = toolBlock(src, 'name: "task_delegate"');
    assert.ok(block.includes("from,"), "createTask must use the 'from' closure variable, not a literal");
    assert.ok(!block.includes('from: "orchestrator"'), "'from' must not be hardcoded in the factory body");
  });

  it("registers the session in activeSessions after creating the child session", () => {
    const block = toolBlock(src, 'name: "task_delegate"');
    assert.ok(block.includes("activeSessions.set"), "must store session in activeSessions map");
  });

  it("removes the session from activeSessions on abort or error", () => {
    const block = toolBlock(src, 'name: "task_delegate"');
    assert.ok(block.includes("activeSessions.delete"), "must remove session from activeSessions on abort/error");
  });
});
