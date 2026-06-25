import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderAbortSummary, abortAllActiveSessions } from "../abort-flow.ts";
import { createTask, updateTaskStatus } from "../task-store.ts";
import { makeTestGitRepo } from "./test-git-repo.ts";
import { cleanupTestTempDir } from "./test-temp.ts";

describe("abort-flow", () => {
  it("renders the root abort summary with active nested task stacks and task snapshot lines", () => {
    const { cwd } = makeTestGitRepo("abort-flow");
    try {
      createTask(cwd, {
        slug: "task-a",
        from: "orchestrator",
        to: "po",
        body: "Do A",
      });
      createTask(cwd, {
        slug: "task-b",
        from: "po",
        to: "architect",
        body: "Do B",
        parent_slug: "task-a",
      });
      createTask(cwd, {
        slug: "task-c",
        from: "architect",
        to: "coder",
        body: "Do C",
        parent_slug: "task-b",
      });
      updateTaskStatus(cwd, "task-c", "blocked", "waiting for answer");

      const activeSessions = new Map<string, any>();
      activeSessions.set("task-a", {
        getSessionStats: () => ({ cost: 1.25, tokens: { input: 12, output: 34 } }),
      });
      activeSessions.set("task-b", {
        getSessionStats: () => ({ cost: 0.75, tokens: { input: 10, output: 20 } }),
      });
      activeSessions.set("task-c", {
        getSessionStats: () => ({ cost: 0.5, tokens: { input: 8, output: 13 } }),
      });

      const summary = renderAbortSummary(cwd, "fatal child session failure in task-b: request was aborted", activeSessions as any);

      assert.match(summary, /⛔ unfolding aborted/);
      assert.match(summary, /reason: fatal child session failure in task-b: request was aborted/);
      assert.match(summary, /active task stack\(s\) being aborted:/);
      assert.match(summary, /- task-a -> task-b -> task-c/);
      assert.match(summary, /task statuses below are the last persisted snapshot:/);
      assert.match(summary, /\[in_progress\] task-a → po/);
      assert.match(summary, /live 💰 \$1\.2500/);
      assert.match(summary, /\[in_progress\] task-b → architect/);
      assert.match(summary, /live 💰 \$0\.7500/);
      assert.match(summary, /\[blocked\] task-c → coder/);
      assert.match(summary, /blocked: waiting for answer/);
      assert.match(summary, /live 💰 \$0\.5000/);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("aborts all active sessions and clears the map", async () => {
    let firstAborted = false;
    let secondAborted = false;
    const activeSessions = new Map<string, any>([
      ["a", { abort: async () => { firstAborted = true; } }],
      ["b", { abort: async () => { secondAborted = true; } }],
    ]);

    await abortAllActiveSessions(activeSessions as any);

    assert.equal(firstAborted, true);
    assert.equal(secondAborted, true);
    assert.equal(activeSessions.size, 0);
  });
});
