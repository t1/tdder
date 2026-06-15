import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createTask, readTask } from "../task-store.ts";
import { taskBlock, taskFinished, taskReopen, taskUnblock } from "../task-tools.ts";
import { resumeDelegatedTask } from "../task-resume.ts";
import { makeTestTempDir, cleanupTestTempDir } from "./test-temp.ts";

function fakeSessions() {
  return new Map();
}

describe("resumeDelegatedTask missing live session", () => {
  it("task_unblock throws, posts diagnostic output, and leaves blocked task unchanged", async () => {
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
        }),
        /task_unblock: no live session found for slug "arch-add-todo"/,
      );

      assert.deepEqual(output, [
        '  ⚠ task_unblock: no live session found for slug "arch-add-todo". This is likely a bug in the unfolding extension — if you don\'t fully understand the cause, print out the current situation and stop working.',
      ]);

      const task = readTask(cwd, "arch-add-todo");
      assert.equal(task?.status, "blocked");
      assert.equal(task?.blocked_reason, "waiting for ADR decision");
      assert.equal(task?.resume_message, undefined);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_reopen throws, posts diagnostic output, and leaves finished task unchanged", async () => {
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
        }),
        /task_reopen: no live session found for slug "arch-add-todo"/,
      );

      assert.deepEqual(output, [
        '  ⚠ task_reopen: no live session found for slug "arch-add-todo". This is likely a bug in the unfolding extension — if you don\'t fully understand the cause, print out the current situation and stop working.',
      ]);

      const task = readTask(cwd, "arch-add-todo");
      assert.equal(task?.status, "finished");
      assert.equal(task?.blocked_reason, undefined);
      assert.equal(task?.resume_message, undefined);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});
