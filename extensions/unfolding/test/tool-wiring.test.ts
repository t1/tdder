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
  it("ask_sensei tool is registered", () => {
    const block = toolBlock(loadSrc(), 'name: "ask_sensei"');
    assert.ok(block.includes("createAskSenseiFn"), "root ask_sensei should capture a reusable UI callback for child sessions");
    assert.ok(block.includes("await askSensei(params)"), "root ask_sensei should execute through the shared fatal-aware wrapper");
  });

  it("task_finished tool wiring is extracted to createChildTaskTools", () => {
    const src = readFileSync(new URL("../child-task-tools.ts", import.meta.url).pathname, "utf8");
    assert.ok(src.includes("task_finished"), "child-task-tools must inject task_finished");
    assert.ok(src.includes("taskFinished"), "must call taskFinished");
    assert.ok(!src.includes("waitForResume"), "must not wait for resume anymore");
  });

  it("task_finished aborts the current child run after checkpointing", () => {
    const src = readFileSync(new URL("../child-task-tools.ts", import.meta.url).pathname, "utf8");
    assert.ok(src.includes("ctx.abort()"), "must abort the current child run after checkpointing");
  });

  it("task_block tool wiring is extracted to createChildTaskTools", () => {
    const src = readFileSync(new URL("../child-task-tools.ts", import.meta.url).pathname, "utf8");
    assert.ok(src.includes("task_block"), "child-task-tools must inject task_block");
    assert.ok(src.includes("taskBlock"), "must call taskBlock");
    assert.ok(!src.includes("waitForResume"), "must not wait for resume anymore");
  });

  it("task_accept tool deletes the task file", () => {
    const block = blockAfter(loadSrc(), 'name: "task_accept"');
    assert.ok(block.includes("taskAccept"), "must call taskAccept");
    // No release needed — child detects deletion via file polling
  });

  it("task_rollback tool calls taskRollback", () => {
    const block = blockAfter(loadSrc(), 'name: "task_rollback"', 1200);
    assert.ok(block.includes("taskRollback"), "must call taskRollback");
  });

  it("task_rollback posts args to postOutput", () => {
    const block = blockAfter(loadSrc(), 'name: "task_rollback"', 1200);
    assert.ok(block.includes("postOutput"), "must post args via postOutput for human visibility");
  });

  it("task_rollback aborts a live session before removing the handle", () => {
    const block = blockAfter(loadSrc(), 'name: "task_rollback"', 1200);
    assert.ok(block.includes(".abort("), "must abort a live session on rollback");
  });

  it("task_rollback removes the active session handle", () => {
    const block = blockAfter(loadSrc(), 'name: "task_rollback"', 1200);
    assert.ok(block.includes("activeSessions.delete"), "must remove session from activeSessions on rollback");
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

  it("task_unblock delegates resume handling to resumeDelegatedTask", () => {
    const block = blockAfter(loadSrc(), 'name: "task_unblock"', 1200);
    assert.ok(block.includes("resumeDelegatedTask"), "must delegate resume handling to resumeDelegatedTask");
  });

  it("task_reopen posts args to postOutput", () => {
    const block = blockAfter(loadSrc(), 'name: "task_reopen"', 1600);
    assert.ok(block.includes("postOutput"), "must post args via postOutput for human visibility");
  });

  it("task_reopen delegates resume handling to resumeDelegatedTask", () => {
    const block = blockAfter(loadSrc(), 'name: "task_reopen"', 1200);
    assert.ok(block.includes("resumeDelegatedTask"), "must delegate resume handling to resumeDelegatedTask");
  });

  it("task_accept posts args to postOutput", () => {
    const block = blockAfter(loadSrc(), 'name: "task_accept"');
    assert.ok(block.includes("postOutput"), "must post args via postOutput for human visibility");
  });

  it("task_reopen exports the commissioner session before resuming the child", () => {
    const block = blockAfter(loadSrc(), 'name: "task_reopen"', 1800);
    assert.ok(block.includes("exportTaskCommissionerDebugHtmlIfEnabled"), "must export commissioner session on reopen in debug mode");
  });

  it("task_unblock exports the commissioner session before resuming the child", () => {
    const block = blockAfter(loadSrc(), 'name: "task_unblock"', 1800);
    assert.ok(block.includes("exportTaskCommissionerDebugHtmlIfEnabled"), "must export commissioner session on unblock in debug mode");
  });

  it("task_accept no longer exports html", () => {
    const block = blockAfter(loadSrc(), 'name: "task_accept"', 800);
    assert.ok(!block.includes("exportTask"), "task_accept must not export html anymore");
  });

  it("task_rollback no longer exports html", () => {
    const block = blockAfter(loadSrc(), 'name: "task_rollback"', 1200);
    assert.ok(!block.includes("exportTask"), "task_rollback must not export html anymore");
  });

  it("task_rollback tool does not delegate to resumeDelegatedTask", () => {
    const block = blockAfter(loadSrc(), 'name: "task_rollback"', 1200);
    assert.ok(!block.includes("resumeDelegatedTask"), "rollback is terminal and must not resume child flow");
  });
});

// ---------------------------------------------------------------------------
// task_delegate wiring
// ---------------------------------------------------------------------------

describe("task_delegate wiring", () => {
  const src = readFileSync(new URL("../task-delegate-tool.ts", import.meta.url).pathname, "utf8");
  const factorySrc = readFileSync(new URL("../session-factory.ts", import.meta.url).pathname, "utf8");
  const commonSrc = readFileSync(new URL("../session-common.ts", import.meta.url).pathname, "utf8");

  it("errors when role agent file not found", () => {
    assert.ok(commonSrc.includes("loadAgentRoleConfig"), "must call loadAgentRoleConfig");
    assert.ok(commonSrc.includes("throw") || commonSrc.includes("No agent definition found"), "must fail when agent file not found");
  });

  it("passes body + CHILD_FIXED_INSTRUCTION as initial message", () => {
    assert.ok(factorySrc.includes("buildChildInitialMessage") || commonSrc.includes("CHILD_FIXED_INSTRUCTION"), "must append CHILD_FIXED_INSTRUCTION");
  });

  it("task_delegate uses extracted child task tools", () => {
    assert.ok(commonSrc.includes("createChildTaskTools"), "must use extracted child task tools");
  });

  it("creates task after obtaining child session id", () => {
    assert.ok(factorySrc.includes("createTask"), "must call createTask");
    assert.ok(factorySrc.includes("session_id"), "must write session_id into task");
    assert.ok(factorySrc.includes("session_file"), "must write session_file into task");
  });

  it("waits for child decision via waitForChildDecision", () => {
    assert.ok(factorySrc.includes("waitForChildDecision"), "must call waitForChildDecision");
  });

  it("accepts optional parent_slug and passes it to createTask", () => {
    assert.ok(src.includes("parent_slug"), "must accept and forward parent_slug");
  });

  it("defines task_continue alongside task_delegate", () => {
    assert.ok(src.includes('name: "task_continue"'), "task-delegate-tool.ts must define task_continue");
  });

  it("uses shortRole as 'from' when creating a task (not hardcoded 'orchestrator')", () => {
    assert.ok(src.includes("from,"), "createTask must use the 'from' closure variable, not a literal");
    assert.ok(!src.includes('from: "orchestrator"'), "'from' must not be hardcoded in the factory body");
  });

  it("pins child sessions to the current tool-call model", () => {
    const delegateSrc = readFileSync(new URL("../task-delegate-tool.ts", import.meta.url).pathname, "utf8");
    const indexSrc = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    assert.ok(delegateSrc.includes("model: ctx.model"), "task_delegate must pass ctx.model into child-session startup");
    assert.ok(indexSrc.includes("model: ctx.model"), "resume flows must pass ctx.model into child-session resume");
    assert.ok(commonSrc.includes("model: selectedModel"), "createAgentSession must receive the selected child model");
  });

  it("registers the session in activeSessions after creating the child session", () => {
    assert.ok(commonSrc.includes("activeSessions.set"), "must store session in activeSessions map");
  });

  it("removes the session from activeSessions on abort or error", () => {
    const delegateSrc = readFileSync(new URL("../task-delegate-tool.ts", import.meta.url).pathname, "utf8");
    assert.ok(delegateSrc.includes("activeSessions.delete"), "must remove session from activeSessions on abort/error");
  });

  it("routes aborted child outcomes through tooling-controlled stack abort handling", () => {
    const delegateSrc = readFileSync(new URL("../task-delegate-tool.ts", import.meta.url).pathname, "utf8");
    assert.ok(delegateSrc.includes("outcome === \"aborted\""), "must branch on aborted child outcome");
    assert.ok(delegateSrc.includes("abortSessionStack"), "must abort the full active session stack in tooling");
  });

  it("task_delegate exports the commissioner session before starting the child", () => {
    const delegateSrc = readFileSync(new URL("../task-delegate-tool.ts", import.meta.url).pathname, "utf8");
    assert.ok(delegateSrc.includes("exportTaskCommissionerDebugHtmlIfEnabled"), "task_delegate must export commissioner session on handover in debug mode");
  });

  it("resolves wildcard tool entries against the live pi tool list before spawning", () => {
    assert.ok(commonSrc.includes("resolveToolAllowlist"), "session-common must call resolveToolAllowlist");
    assert.ok(commonSrc.includes("getAllTools"), "session-common must read live tools from pi.getAllTools()");
  });

  it("monkey-patches emitToolCall to enforce path restrictions after session creation", () => {
    assert.ok(commonSrc.includes("emitToolCall"), "session-common must patch emitToolCall for path restrictions");
    assert.ok(commonSrc.includes("isPathAllowed"), "session-common must call isPathAllowed");
    assert.ok(commonSrc.includes("pathRestrictions"), "session-common must read pathRestrictions from roleConfig");
  });
});
