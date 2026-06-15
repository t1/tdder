/**
 * Tests for task tools logic and structural invariants.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import { makeTestTempDir, cleanupTestTempDir } from "./test-temp.ts";

let dir: string;
before(() => { dir = makeTestTempDir("task-tools-test"); });
after(() => { cleanupTestTempDir(dir); });

// ---------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------

describe("structural invariants", () => {
  it("registers the commissioner tools in index.ts, delegate tool in task-delegate-tool.ts, and child tools in child-task-tools.ts", () => {
    const indexSrc = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const delegateSrc = readFileSync(new URL("../task-delegate-tool.ts", import.meta.url).pathname, "utf8");
    const childSrc = readFileSync(new URL("../child-task-tools.ts", import.meta.url).pathname, "utf8");
    for (const name of ["task_list", "task_read", "task_accept", "task_reopen", "task_unblock"]) {
      assert.ok(indexSrc.includes(`"${name}"`), `index.ts must register tool "${name}"`);
    }
    assert.ok(delegateSrc.includes('name: "task_delegate"'), "task-delegate-tool.ts must define task_delegate");
    for (const name of ["task_finished", "task_block"]) {
      assert.ok(childSrc.includes(`"${name}"`), `child-task-tools.ts must define tool "${name}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// task_list
// ---------------------------------------------------------------------------

describe("taskList", () => {
  it("returns only tasks from orchestrator by default", () => {
    const cwd = makeTestTempDir("tools-test");
    try {
      createTask(cwd, { slug: "po-define-login", from: "orchestrator", to: "po", body: "Define login" });
      createTask(cwd, { slug: "arch-impl-login", from: "po", to: "architect", body: "Implement login" });
      const result = taskList(cwd);
      assert.ok(result.includes("po-define-login"), "should include orchestrator task");
      assert.ok(!result.includes("arch-impl-login"), "should not include sub-delegated task");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("returns all tasks when from is '*'", () => {
    const cwd = makeTestTempDir("tools-test");
    try {
      createTask(cwd, { slug: "po-define-login", from: "orchestrator", to: "po", body: "Define login" });
      createTask(cwd, { slug: "arch-impl-login", from: "po", to: "architect", body: "Implement login" });
      const result = taskList(cwd, "*");
      assert.ok(result.includes("po-define-login"));
      assert.ok(result.includes("arch-impl-login"));
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("shows blocked_reason when task is blocked", () => {
    const cwd = makeTestTempDir("tools-test");
    try {
      createTask(cwd, { slug: "blocked-task", from: "orchestrator", to: "po", body: "Do it" });
      taskBlock(cwd, "blocked-task", "waiting for DMD: naming");
      const result = taskList(cwd);
      assert.ok(result.includes("waiting for DMD: naming"), "should include blocked_reason");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("shows live indicator when session is active", () => {
    const cwd = makeTestTempDir("tools-test");
    try {
      createTask(cwd, { slug: "live-task", from: "orchestrator", to: "po", body: "Do it" });
      const fakeSessions = new Map([["live-task", { getSessionStats: () => ({ cost: 0, tokens: { input: 0, output: 0 } }) } as any]]);
      const result = taskList(cwd, "orchestrator", fakeSessions);
      assert.ok(result.includes("live"), "should include live indicator");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("shows cost when session provides stats", () => {
    const cwd = makeTestTempDir("tools-test");
    try {
      createTask(cwd, { slug: "costed-task", from: "orchestrator", to: "po", body: "Do it" });
      const fakeSession = { getSessionStats: () => ({ cost: 0.0123, tokens: { input: 100, output: 50 } }) } as any;
      const fakeSessions = new Map([["costed-task", fakeSession]]);
      const result = taskList(cwd, "orchestrator", fakeSessions);
      assert.ok(result.includes("0.0123") || result.includes("0.01"), "should include cost");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("returns a message when no tasks exist", () => {
    const cwd = makeTestTempDir("tools-test");
    try {
      const result = taskList(cwd);
      assert.ok(result.length > 0, "should return a non-empty message");
      assert.ok(result.toLowerCase().includes("no") || result.toLowerCase().includes("empty"));
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

// ---------------------------------------------------------------------------
// task_read
// ---------------------------------------------------------------------------

describe("taskRead", () => {
  it("returns full task details for a known slug", () => {
    const cwd = makeTestTempDir("tools-test");
    try {
      createTask(cwd, { slug: "read-me", from: "orchestrator", to: "po", body: "Some body text", session_file: "/tmp/session.jsonl" });
      const result = taskRead(cwd, "read-me");
      assert.ok(result.includes("read-me"));
      assert.ok(result.includes("in_progress"));
      assert.ok(result.includes("Some body text"));
      assert.ok(result.includes("session_file: /tmp/session.jsonl"));
    } finally {
      cleanupTestTempDir(cwd);
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
    const cwd = makeTestTempDir("tools-test");
    try {
      createTask(cwd, { slug: "finish-me", from: "orchestrator", to: "coder", body: "Do it" });
      taskFinished(cwd, "finish-me");
      const result = taskList(cwd);
      assert.ok(result.includes("finished"));
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

// ---------------------------------------------------------------------------
// task_block
// ---------------------------------------------------------------------------

describe("taskBlock", () => {
  it("sets task status to blocked with reason", () => {
    const cwd = makeTestTempDir("tools-test");
    try {
      createTask(cwd, { slug: "block-me", from: "po", to: "coder", body: "Do it" });
      taskBlock(cwd, "block-me", "waiting for decision");
      const result = taskRead(cwd, "block-me");
      assert.ok(result.includes("blocked"));
      assert.ok(result.includes("waiting for decision"));
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("throws when blocked_reason is missing", () => {
    const cwd = makeTestTempDir("tools-test");
    try {
      createTask(cwd, { slug: "block-no-reason", from: "po", to: "coder", body: "Do it" });
      assert.throws(() => taskBlock(cwd, "block-no-reason", undefined), /blocked_reason/);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

// ---------------------------------------------------------------------------
// task_accept
// ---------------------------------------------------------------------------

describe("taskAccept", () => {
  it("deletes the task", () => {
    const cwd = makeTestTempDir("tools-test");
    try {
      createTask(cwd, { slug: "accept-me", from: "orchestrator", to: "po", body: "Done" });
      taskAccept(cwd, "accept-me");
      assert.throws(() => taskRead(cwd, "accept-me"), /accept-me/);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

// ---------------------------------------------------------------------------
// task_reopen
// ---------------------------------------------------------------------------

describe("taskReopen", () => {
  it("sets task status to in_progress", () => {
    const cwd = makeTestTempDir("tools-test");
    try {
      createTask(cwd, { slug: "reopen-me", from: "orchestrator", to: "po", body: "Redo" });
      taskFinished(cwd, "reopen-me");
      taskReopen(cwd, "reopen-me", "needs more work");
      const result = taskRead(cwd, "reopen-me");
      assert.ok(result.includes("in_progress"));
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

describe("taskUnblock", () => {
  it("sets task status to in_progress", () => {
    const cwd = makeTestTempDir("tools-test");
    try {
      createTask(cwd, { slug: "unblock-me", from: "orchestrator", to: "po", body: "Continue" });
      taskBlock(cwd, "unblock-me", "a reason");
      taskUnblock(cwd, "unblock-me");
      const result = taskRead(cwd, "unblock-me");
      assert.ok(result.includes("in_progress"));
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

describe("taskReopen resume_message", () => {
  it("writes resume_message as 'reopened: <reason>'", () => {
    const cwd = makeTestTempDir("tools-test");
    try {
      createTask(cwd, { slug: "reopen-msg", from: "orchestrator", to: "po", body: "Redo" });
      taskFinished(cwd, "reopen-msg");
      taskReopen(cwd, "reopen-msg", "the output was wrong");
      const result = taskRead(cwd, "reopen-msg");
      assert.ok(result.includes("reopened: the output was wrong"), "resume_message must include reason");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

describe("taskUnblock resume_message", () => {
  it("writes 'unblocked: <reason>' when reason given", () => {
    const cwd = makeTestTempDir("tools-test");
    try {
      createTask(cwd, { slug: "unblock-reason", from: "orchestrator", to: "po", body: "Continue" });
      taskBlock(cwd, "unblock-reason", "waiting for info");
      taskUnblock(cwd, "unblock-reason", "info arrived");
      const result = taskRead(cwd, "unblock-reason");
      assert.ok(result.includes("unblocked: info arrived"), "resume_message must include reason");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("writes 'unblocked' when no reason given", () => {
    const cwd = makeTestTempDir("tools-test");
    try {
      createTask(cwd, { slug: "unblock-noreason", from: "orchestrator", to: "po", body: "Continue" });
      taskBlock(cwd, "unblock-noreason", "waiting");
      taskUnblock(cwd, "unblock-noreason");
      const result = taskRead(cwd, "unblock-noreason");
      assert.ok(result.includes("resume_message: |\n  unblocked"), "resume_message must be 'unblocked'");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});
