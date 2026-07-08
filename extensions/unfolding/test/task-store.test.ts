/**
 * Tests for the task store.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  createTask,
  readTask,
  listTasks,
  updateTaskStatus,
  deleteTask,
  classifyDirectDelegate,
} from "../task-store.ts";
import { assertValidRootWorkflow, assertValidTaskTree } from "../task-summary.ts";
import { makeTestTempDir, cleanupTestTempDir } from "./test-temp.ts";
import { makeTestGitRepo } from "./test-git-repo.ts";

let dir: string;
before(() => { dir = makeTestTempDir("unfolding-test"); });
after(() => { cleanupTestTempDir(dir); });


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

  it("writes task and export ignore rules to .git/info/exclude without touching .gitignore", () => {
    const { cwd } = makeTestGitRepo("task-test");
    try {
      createTask(cwd, { slug: "gitignore-me", from: "orchestrator", to: "po", body: "Implement login" });
      const exclude = readFileSync(join(cwd, ".git", "info", "exclude"), "utf8");
      assert.ok(exclude.includes(".pi/unfolding/tasks/"));
      assert.ok(exclude.includes(".pi/unfolding/exports/"));
      assert.equal(existsSync(join(cwd, ".gitignore")), false, "createTask should not create or modify .gitignore");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
  it("uses an opaque filename, not the slug", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "arch-impl-login", from: "orchestrator", to: "po", body: "Implement login" });
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
      createTask(cwd, { slug: "duplicate-slug", from: "orchestrator", to: "po", body: "First" });
      assert.throws(
        () => createTask(cwd, { slug: "duplicate-slug", from: "orchestrator", to: "po", body: "Second" }),
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
      createTask(cwd, { slug: "task-b", from: "po", to: "architect", body: "B", parent_slug: "task-a" });
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
      createTask(cwd, { slug: "finish-me", from: "orchestrator", to: "po", body: "Do it" });
      updateTaskStatus(cwd, "finish-me", "finished");
      assert.equal(readTask(cwd, "finish-me")?.status, "finished");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("writes resume_message when provided", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "msg-me", from: "orchestrator", to: "po", body: "Do it" });
      updateTaskStatus(cwd, "msg-me", "in_progress", undefined, "reopened: try again");
      assert.equal(readTask(cwd, "msg-me")?.resume_message, "reopened: try again");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("round-trips multi-line resume_message", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "ml-msg", from: "orchestrator", to: "po", body: "Do it" });
      updateTaskStatus(cwd, "ml-msg", "in_progress", undefined, "reopened: line one\nline two\nline three");
      assert.equal(readTask(cwd, "ml-msg")?.resume_message, "reopened: line one\nline two\nline three");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("round-trips multi-line blocked_reason", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "ml-block", from: "orchestrator", to: "po", body: "Do it" });
      updateTaskStatus(cwd, "ml-block", "blocked", "waiting for:\n- decision A\n- decision B");
      assert.equal(readTask(cwd, "ml-block")?.blocked_reason, "waiting for:\n- decision A\n- decision B");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("clears resume_message when not provided", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "clear-msg", from: "orchestrator", to: "po", body: "Do it" });
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
      createTask(cwd, { slug: "block-me", from: "orchestrator", to: "po", body: "Do it" });
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
      createTask(cwd, { slug: "reopen-me", from: "orchestrator", to: "po", body: "Do it" });
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
      createTask(cwd, { slug: "delete-me", from: "orchestrator", to: "po", body: "Gone" });
      deleteTask(cwd, "delete-me");
      assert.equal(readTask(cwd, "delete-me"), null);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

describe("task tree invariants", () => {
  it("rejects a non-PO top-level root workflow", () => {
    assert.throws(
      () => assertValidRootWorkflow([
        { slug: "arch-root", status: "in_progress", from: "orchestrator", to: "architect", body: "bad" },
      ] as any),
      /role "orchestrator" may not delegate to "architect"|top-level task must be orchestrator -> po/,
    );
  });

  it("rejects a child whose from role does not match the parent role", () => {
    assert.throws(
      () => assertValidTaskTree([
        { slug: "po-root", status: "in_progress", from: "orchestrator", to: "po", body: "root" },
        { slug: "code-1", status: "in_progress", from: "architect", to: "coder", body: "bad", parent_slug: "po-root" },
      ] as any),
      /delegated from "architect", but its parent role is "po"/,
    );
  });

  it("rejects a disallowed delegation edge even when the parent link matches", () => {
    assert.throws(
      () => assertValidTaskTree([
        { slug: "po-root", status: "in_progress", from: "orchestrator", to: "po", body: "root" },
        { slug: "code-1", status: "in_progress", from: "po", to: "coder", body: "bad", parent_slug: "po-root" },
      ] as any),
      /role "po" may not delegate to "coder"/,
    );
  });
});

describe("classifyDirectDelegate", () => {
  it("returns none when no direct delegate exists", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      assert.deepEqual(classifyDirectDelegate(cwd, "orchestrator"), { kind: "none" });
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("returns the in_progress direct delegate", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "po-root", from: "orchestrator", to: "po", body: "root" });
      assert.deepEqual(classifyDirectDelegate(cwd, "orchestrator"), {
        kind: "in_progress",
        task: readTask(cwd, "po-root")!,
      });
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("returns the blocked direct delegate", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "po-root", from: "orchestrator", to: "po", body: "root" });
      updateTaskStatus(cwd, "po-root", "blocked", "need clarification");
      assert.deepEqual(classifyDirectDelegate(cwd, "orchestrator"), {
        kind: "blocked",
        task: readTask(cwd, "po-root")!,
      });
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("returns the finished direct delegate", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "po-root", from: "orchestrator", to: "po", body: "root" });
      updateTaskStatus(cwd, "po-root", "finished");
      assert.deepEqual(classifyDirectDelegate(cwd, "orchestrator"), {
        kind: "finished",
        task: readTask(cwd, "po-root")!,
      });
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

describe("tasks.yaml summary", () => {
  it("writes a compact live summary for the current task chain", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "po-todo-webapp", from: "orchestrator", to: "po", body: "PO" });
      createTask(cwd, { slug: "arch-001-add-todo-v2", from: "po", to: "architect", body: "ARCH", parent_slug: "po-todo-webapp" });
      createTask(cwd, { slug: "code-001-add-todo", from: "architect", to: "coder", body: "CODE", parent_slug: "arch-001-add-todo-v2" });
      updateTaskStatus(cwd, "code-001-add-todo", "blocked", "waiting for persistence decision");

      const summary = readFileSync(join(cwd, ".pi", "unfolding", "tasks.yaml"), "utf8");
      assert.equal(summary, [
        "slug: po-todo-webapp",
        "role: po",
        "status: in_progress",
        "delegate:",
        "  slug: arch-001-add-todo-v2",
        "  role: architect",
        "  status: in_progress",
        "  delegate:",
        "    slug: code-001-add-todo",
        "    role: coder",
        "    status: blocked",
        "    blocked_reason: |",
        "      waiting for persistence decision",
        "",
      ].join("\n"));
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("deletes tasks.yaml when the last task is deleted", () => {
    const cwd = makeTestTempDir("task-test");
    try {
      createTask(cwd, { slug: "po-todo-webapp", from: "orchestrator", to: "po", body: "PO" });
      assert.equal(existsSync(join(cwd, ".pi", "unfolding", "tasks.yaml")), true);
      deleteTask(cwd, "po-todo-webapp");
      assert.equal(existsSync(join(cwd, ".pi", "unfolding", "tasks.yaml")), false);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});
