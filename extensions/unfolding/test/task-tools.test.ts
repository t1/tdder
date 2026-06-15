/**
 * Tests for task tools logic and structural invariants.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask } from "../task-store.ts";
import {
  taskList,
  taskRead,
  taskFinished,
  taskBlock,
  taskAccept,
  taskReopen,
  taskUnblock,
} from "../task-tools.ts";

let dir: string;
before(() => { dir = mkdtempSync(tmpdir() + "/task-tools-test-"); });
after(() => { rmSync(dir, { recursive: true }); });

// ---------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------

describe("structural invariants", () => {
  it("all 8 task tool names are registered in index.ts", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const tools = [
      "task_list", "task_read",
      "task_finished", "task_block",
      "task_delegate", "task_accept", "task_reopen", "task_unblock",
    ];
    for (const name of tools) {
      assert.ok(src.includes(`"${name}"`), `index.ts must register tool "${name}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// task_list
// ---------------------------------------------------------------------------

describe("taskList", () => {
  it("returns only tasks from orchestrator by default", () => {
    const cwd = mkdtempSync(tmpdir() + "/tools-test-");
    try {
      createTask(cwd, { slug: "po-define-login", from: "orchestrator", to: "po", body: "Define login" });
      createTask(cwd, { slug: "arch-impl-login", from: "po", to: "architect", body: "Implement login" });
      const result = taskList(cwd);
      assert.ok(result.includes("po-define-login"), "should include orchestrator task");
      assert.ok(!result.includes("arch-impl-login"), "should not include sub-delegated task");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  it("returns all tasks when from is '*'", () => {
    const cwd = mkdtempSync(tmpdir() + "/tools-test-");
    try {
      createTask(cwd, { slug: "po-define-login", from: "orchestrator", to: "po", body: "Define login" });
      createTask(cwd, { slug: "arch-impl-login", from: "po", to: "architect", body: "Implement login" });
      const result = taskList(cwd, "*");
      assert.ok(result.includes("po-define-login"));
      assert.ok(result.includes("arch-impl-login"));
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  it("returns a message when no tasks exist", () => {
    const cwd = mkdtempSync(tmpdir() + "/tools-test-");
    try {
      const result = taskList(cwd);
      assert.ok(result.length > 0, "should return a non-empty message");
      assert.ok(result.toLowerCase().includes("no") || result.toLowerCase().includes("empty"));
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// task_read
// ---------------------------------------------------------------------------

describe("taskRead", () => {
  it("returns full task details for a known slug", () => {
    const cwd = mkdtempSync(tmpdir() + "/tools-test-");
    try {
      createTask(cwd, { slug: "read-me", from: "orchestrator", to: "po", body: "Some body text" });
      const result = taskRead(cwd, "read-me");
      assert.ok(result.includes("read-me"));
      assert.ok(result.includes("in_progress"));
      assert.ok(result.includes("Some body text"));
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  it("throws on unknown slug", () => {
    assert.throws(() => taskRead(dir, "ghost"), /ghost/);
  });
});

// ---------------------------------------------------------------------------
// task_finished
// ---------------------------------------------------------------------------

describe("taskFinished", () => {
  it("sets task status to finished", () => {
    const cwd = mkdtempSync(tmpdir() + "/tools-test-");
    try {
      createTask(cwd, { slug: "finish-me", from: "orchestrator", to: "coder", body: "Do it" });
      taskFinished(cwd, "finish-me");
      const result = taskList(cwd);
      assert.ok(result.includes("finished"));
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// task_block
// ---------------------------------------------------------------------------

describe("taskBlock", () => {
  it("sets task status to blocked with reason", () => {
    const cwd = mkdtempSync(tmpdir() + "/tools-test-");
    try {
      createTask(cwd, { slug: "block-me", from: "po", to: "coder", body: "Do it" });
      taskBlock(cwd, "block-me", "waiting for decision");
      const result = taskRead(cwd, "block-me");
      assert.ok(result.includes("blocked"));
      assert.ok(result.includes("waiting for decision"));
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  it("throws when blocked_reason is missing", () => {
    const cwd = mkdtempSync(tmpdir() + "/tools-test-");
    try {
      createTask(cwd, { slug: "block-no-reason", from: "po", to: "coder", body: "Do it" });
      assert.throws(() => taskBlock(cwd, "block-no-reason", undefined), /blocked_reason/);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// task_accept
// ---------------------------------------------------------------------------

describe("taskAccept", () => {
  it("deletes the task", () => {
    const cwd = mkdtempSync(tmpdir() + "/tools-test-");
    try {
      createTask(cwd, { slug: "accept-me", from: "orchestrator", to: "po", body: "Done" });
      taskAccept(cwd, "accept-me");
      assert.throws(() => taskRead(cwd, "accept-me"), /accept-me/);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// task_reopen
// ---------------------------------------------------------------------------

describe("taskReopen", () => {
  it("sets task status to in_progress", () => {
    const cwd = mkdtempSync(tmpdir() + "/tools-test-");
    try {
      createTask(cwd, { slug: "reopen-me", from: "orchestrator", to: "po", body: "Redo" });
      taskFinished(cwd, "reopen-me");
      taskReopen(cwd, "reopen-me", "needs more work");
      const result = taskRead(cwd, "reopen-me");
      assert.ok(result.includes("in_progress"));
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});

describe("taskUnblock", () => {
  it("sets task status to in_progress", () => {
    const cwd = mkdtempSync(tmpdir() + "/tools-test-");
    try {
      createTask(cwd, { slug: "unblock-me", from: "orchestrator", to: "po", body: "Continue" });
      taskBlock(cwd, "unblock-me", "a reason");
      taskUnblock(cwd, "unblock-me");
      const result = taskRead(cwd, "unblock-me");
      assert.ok(result.includes("in_progress"));
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});

describe("taskReopen resume_message", () => {
  it("writes resume_message as 'reopened: <reason>'", () => {
    const cwd = mkdtempSync(tmpdir() + "/tools-test-");
    try {
      createTask(cwd, { slug: "reopen-msg", from: "orchestrator", to: "po", body: "Redo" });
      taskFinished(cwd, "reopen-msg");
      taskReopen(cwd, "reopen-msg", "the output was wrong");
      const result = taskRead(cwd, "reopen-msg");
      assert.ok(result.includes("reopened: the output was wrong"), "resume_message must include reason");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});

describe("taskUnblock resume_message", () => {
  it("writes 'unblocked: <reason>' when reason given", () => {
    const cwd = mkdtempSync(tmpdir() + "/tools-test-");
    try {
      createTask(cwd, { slug: "unblock-reason", from: "orchestrator", to: "po", body: "Continue" });
      taskBlock(cwd, "unblock-reason", "waiting for info");
      taskUnblock(cwd, "unblock-reason", "info arrived");
      const result = taskRead(cwd, "unblock-reason");
      assert.ok(result.includes("unblocked: info arrived"), "resume_message must include reason");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  it("writes 'unblocked' when no reason given", () => {
    const cwd = mkdtempSync(tmpdir() + "/tools-test-");
    try {
      createTask(cwd, { slug: "unblock-noreason", from: "orchestrator", to: "po", body: "Continue" });
      taskBlock(cwd, "unblock-noreason", "waiting");
      taskUnblock(cwd, "unblock-noreason");
      const result = taskRead(cwd, "unblock-noreason");
      assert.ok(result.includes("resume_message: unblocked"), "resume_message must be 'unblocked'");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});
