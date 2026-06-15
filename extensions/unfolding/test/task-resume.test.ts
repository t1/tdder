import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTask, readTask } from "../task-store.ts";
import { taskBlock, taskFinished, taskReopen, taskUnblock } from "../task-tools.ts";
import { resumeDelegatedTask } from "../task-resume.ts";
import { restoreChildSession } from "../session-restore.ts";
import { makeTestTempDir, cleanupTestTempDir } from "./test-temp.ts";

function nestedDelegateToolFactory(_shortRole: string) {
  return {
    name: "task_delegate",
    label: "Task delegate",
    description: "stub",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: "stub" }], details: {} };
    },
  };
}

function fakeSessions() {
  return new Map();
}

describe("restoreChildSession", () => {
  it("returns null when session_file is missing", async () => {
    const cwd = makeTestTempDir("resume-task");
    try {
      createTask(cwd, { slug: "arch-add-todo", from: "po", to: "architect", body: "Continue" });
      const result = await restoreChildSession(cwd, "arch-add-todo", new Map() as any, {} as any, () => {}, nestedDelegateToolFactory);
      assert.equal(result, null);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("returns null when session_file does not exist", async () => {
    const cwd = makeTestTempDir("resume-task");
    try {
      createTask(cwd, { slug: "arch-add-todo", from: "po", to: "architect", body: "Continue", session_file: join(cwd, "missing.jsonl") });
      const result = await restoreChildSession(cwd, "arch-add-todo", new Map() as any, {} as any, () => {}, nestedDelegateToolFactory);
      assert.equal(result, null);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("restores a session when session_file exists", async () => {
    const cwd = makeTestTempDir("resume-task");
    try {
      const sessionFile = join(cwd, "session.jsonl");
      writeFileSync(sessionFile, JSON.stringify({ version: 1, cwd }) + "\n");
      createTask(cwd, { slug: "arch-add-todo", from: "po", to: "architect", body: "Continue", session_file: sessionFile });
      const result = await restoreChildSession(cwd, "arch-add-todo", new Map() as any, {} as any, () => {}, nestedDelegateToolFactory);
      assert.ok(result !== null);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

describe("resumeDelegatedTask restore and fallback behavior", () => {
  it("task_unblock throws when no live session and no restore is possible", async () => {
    const cwd = makeTestTempDir("resume-task");
    const output: string[] = [];
    try {
      createTask(cwd, { slug: "arch-add-todo", from: "po", to: "architect", body: "Continue" });
      taskBlock(cwd, "arch-add-todo", "waiting for ADR decision");

      await assert.rejects(
        () => resumeDelegatedTask({
          action: "unblock",
          cwd,
          slug: "arch-add-todo",
          reason: "ADR approved",
          activeSessions: fakeSessions() as any,
          postOutput: (line) => output.push(line),
          mutateTask: taskUnblock,
          pi: {} as any,
        }),
        /task_unblock: no live session found for slug "arch-add-todo", and the session could not be restored/,
      );

      assert.deepEqual(output, [
        '  ⚠ task_unblock: no live session found for slug "arch-add-todo", and the session could not be restored. This is likely a bug in the unfolding extension — if you don\'t fully understand the cause, print out the current situation and stop working.',
      ]);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_reopen throws when no live session and no restore is possible", async () => {
    const cwd = makeTestTempDir("resume-task");
    const output: string[] = [];
    try {
      createTask(cwd, { slug: "arch-add-todo", from: "po", to: "architect", body: "Continue" });
      taskFinished(cwd, "arch-add-todo");

      await assert.rejects(
        () => resumeDelegatedTask({
          action: "reopen",
          cwd,
          slug: "arch-add-todo",
          reason: "please revise the ADR",
          activeSessions: fakeSessions() as any,
          postOutput: (line) => output.push(line),
          mutateTask: taskReopen,
          pi: {} as any,
        }),
        /task_reopen: no live session found for slug "arch-add-todo", and the session could not be restored/,
      );

      assert.deepEqual(output, [
        '  ⚠ task_reopen: no live session found for slug "arch-add-todo", and the session could not be restored. This is likely a bug in the unfolding extension — if you don\'t fully understand the cause, print out the current situation and stop working.',
      ]);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_unblock restores a real blocked child session and reaches the next checkpoint", async () => {
    const cwd = makeTestTempDir("resume-task");
    try {
      const activeSessions = new Map() as any;
      const { startChildSession } = await import("../session-factory.ts");
      await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-resume",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions,
        pi: {} as any,
        postOutput: () => {},
        nestedDelegateToolFactory: (_shortRole: string) => ({
          name: "task_delegate",
          label: "Task delegate",
          description: "stub",
          parameters: { type: "object", properties: {} },
          async execute() {
            return { content: [{ type: "text", text: "stub" }], details: {} };
          },
        }),
      });

      activeSessions.delete("coder-resume");

      const outcome = await resumeDelegatedTask({
        action: "unblock",
        cwd,
        slug: "coder-resume",
        reason: "continue",
        activeSessions,
        postOutput: () => {},
        mutateTask: taskUnblock,
        pi: {} as any,
      });

      assert.ok(outcome === "blocked" || outcome === "finished", `unexpected outcome: ${outcome}`);
      const task = readTask(cwd, "coder-resume");
      assert.ok(task?.status === "blocked" || task?.status === "finished", `unexpected status: ${task?.status}`);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});
