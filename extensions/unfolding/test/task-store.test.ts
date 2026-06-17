/**
 * Tests for the task store.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ensureGitignore,
  createTask,
  readTask,
  listTasks,
  updateTaskStatus,
  deleteTask,
} from "../task-store.ts";
import { makeTestTempDir, cleanupTestTempDir } from "./test-temp.ts";

let dir: string;
before(() => { dir = makeTestTempDir("unfolding-test"); });
after(() => { cleanupTestTempDir(dir); });

// ---------------------------------------------------------------------------
// ensureGitignore
// ---------------------------------------------------------------------------

describe("ensureGitignore", () => {
  it("adds the rule when .gitignore does not exist", () => {
    const cwd = makeTestTempDir("gitignore-test");
    try {
      ensureGitignore(cwd);
      const content = readFileSync(join(cwd, ".gitignore"), "utf8");
      assert.ok(content.includes(".pi/unfolding/tasks/"));
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
  it("adds the rule when .gitignore exists but lacks the rule", () => {
    const cwd = makeTestTempDir("gitignore-test");
    try {
      writeFileSync(join(cwd, ".gitignore"), "node_modules/\n");
      ensureGitignore(cwd);
      const content = readFileSync(join(cwd, ".gitignore"), "utf8");
      assert.ok(content.includes(".pi/unfolding/tasks/"));
      assert.ok(content.includes("node_modules/"), "existing content must be preserved");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
  it("leaves .gitignore unchanged when rule already present", () => {
    const cwd = makeTestTempDir("gitignore-test");
    try {
      const original = "node_modules/\n.pi/unfolding/tasks/\n";
      writeFileSync(join(cwd, ".gitignore"), original);
      ensureGitignore(cwd);
      const content = readFileSync(join(cwd, ".gitignore"), "utf8");
      assert.equal(content, original);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

describe("createTask", () => {
  it("writes a task file with correct YAML fields", () => {
    const task = createTask(dir, {
      slug: "po-define-login",
      from: "orchestrator",
      to: "po",
      body: "Define the login feature.",
    });
    assert.equal(task.slug, "po-define-login");
    assert.equal(task.status, "in_progress");
    assert.equal(task.from, "orchestrator");
    assert.equal(task.to, "po");
    assert.equal(task.body, "Define the login feature.");
  });

  it("ensures the task directory is gitignored", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "gitignore-me", from: "po", to: "architect", body: "Implement login" });
      const gitignore = readFileSync(join(cwd, ".gitignore"), "utf8");
      assert.ok(gitignore.includes(".pi/unfolding/tasks/"));
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
  it("uses an opaque filename, not the slug", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "arch-impl-login", from: "po", to: "architect", body: "Implement login" });
      const files = readdirSync(join(cwd, ".pi/unfolding/tasks"));
      assert.equal(files.length, 1);
      assert.ok(!files[0].includes("arch-impl-login"), `filename must not contain slug, got: ${files[0]}`);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("throws when a task with the same slug already exists", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "duplicate-slug", from: "po", to: "architect", body: "First" });
      assert.throws(
        () => createTask(cwd, { slug: "duplicate-slug", from: "po", to: "architect", body: "Second" }),
        /duplicate-slug/,
      );
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

// ---------------------------------------------------------------------------
// readTask
// ---------------------------------------------------------------------------

describe("readTask", () => {
  it("returns the task by slug", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "po-read-me", from: "orchestrator", to: "po", body: "Do this" });
      const task = readTask(cwd, "po-read-me");
      assert.ok(task !== null);
      assert.equal(task.slug, "po-read-me");
      assert.equal(task.to, "po");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("round-trips session_file", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "po-session-file", from: "orchestrator", to: "po", body: "Do this", session_file: "/tmp/session.jsonl" });
      const task = readTask(cwd, "po-session-file");
      assert.equal(task?.session_file, "/tmp/session.jsonl");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("returns null for an unknown slug", () => {
    assert.equal(readTask(dir, "nonexistent-slug"), null);
  });
});

// ---------------------------------------------------------------------------
// listTasks
// ---------------------------------------------------------------------------

describe("listTasks", () => {
  it("returns all tasks", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "task-a", from: "orchestrator", to: "po", body: "A" });
      createTask(cwd, { slug: "task-b", from: "po", to: "architect", body: "B" });
      const tasks = listTasks(cwd);
      assert.equal(tasks.length, 2);
      const slugs = tasks.map(t => t.slug).sort();
      assert.deepEqual(slugs, ["task-a", "task-b"]);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("returns empty array when no tasks exist", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      assert.deepEqual(listTasks(cwd), []);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

// ---------------------------------------------------------------------------
// updateTaskStatus
// ---------------------------------------------------------------------------

describe("updateTaskStatus", () => {
  it("updates status to finished", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "finish-me", from: "po", to: "coder", body: "Do it" });
      updateTaskStatus(cwd, "finish-me", "finished");
      assert.equal(readTask(cwd, "finish-me")?.status, "finished");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("writes resume_message when provided", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "msg-me", from: "po", to: "coder", body: "Do it" });
      updateTaskStatus(cwd, "msg-me", "in_progress", undefined, "reopened: try again");
      assert.equal(readTask(cwd, "msg-me")?.resume_message, "reopened: try again");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("round-trips multi-line resume_message", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "ml-msg", from: "po", to: "coder", body: "Do it" });
      updateTaskStatus(cwd, "ml-msg", "in_progress", undefined, "reopened: line one\nline two\nline three");
      assert.equal(readTask(cwd, "ml-msg")?.resume_message, "reopened: line one\nline two\nline three");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("round-trips multi-line blocked_reason", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "ml-block", from: "po", to: "coder", body: "Do it" });
      updateTaskStatus(cwd, "ml-block", "blocked", "waiting for:\n- decision A\n- decision B");
      assert.equal(readTask(cwd, "ml-block")?.blocked_reason, "waiting for:\n- decision A\n- decision B");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("clears resume_message when not provided", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "clear-msg", from: "po", to: "coder", body: "Do it" });
      updateTaskStatus(cwd, "clear-msg", "in_progress", undefined, "old message");
      updateTaskStatus(cwd, "clear-msg", "finished");
      assert.equal(readTask(cwd, "clear-msg")?.resume_message, undefined);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("updates status to blocked and sets blocked_reason", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "block-me", from: "po", to: "coder", body: "Do it" });
      updateTaskStatus(cwd, "block-me", "blocked", "waiting for ADR decision");
      const task = readTask(cwd, "block-me");
      assert.equal(task?.status, "blocked");
      assert.equal(task?.blocked_reason, "waiting for ADR decision");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("updates status back to in_progress", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "reopen-me", from: "po", to: "coder", body: "Do it" });
      updateTaskStatus(cwd, "reopen-me", "blocked", "a reason");
      updateTaskStatus(cwd, "reopen-me", "in_progress");
      const task = readTask(cwd, "reopen-me");
      assert.equal(task?.status, "in_progress");
      assert.equal(task?.blocked_reason, undefined);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

// ---------------------------------------------------------------------------
// deleteTask
// ---------------------------------------------------------------------------

describe("deleteTask", () => {
  it("removes the task file", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "delete-me", from: "po", to: "coder", body: "Gone" });
      deleteTask(cwd, "delete-me");
      assert.equal(readTask(cwd, "delete-me"), null);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});
