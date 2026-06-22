import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderAbortSummary, abortAllActiveSessions } from "../abort-flow.ts";
import { createTask, updateTaskStatus } from "../task-store.ts";
import { makeTestGitRepo } from "./test-git-repo.ts";
import { cleanupTestTempDir } from "./test-temp.ts";

describe("abort-flow", () => {
  it("renders the root abort summary with task snapshot lines", () => {
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
      });
      updateTaskStatus(cwd, "task-b", "blocked", "waiting for answer");

      const activeSessions = new Map<string, any>();
      activeSessions.set("task-a", {
        getSessionStats: () => ({ cost: 1.25, tokens: { input: 12, output: 34 } }),
      });

      const summary = renderAbortSummary(cwd, "fatal child session failure in task-b: ask_sensei failed", activeSessions as any);

      assert.match(summary, /⛔ unfolding aborted/);
      assert.match(summary, /reason: fatal child session failure in task-b: ask_sensei failed/);
      assert.match(summary, /task statuses below are the last persisted snapshot:/);
      assert.match(summary, /\[in_progress\] task-a → po/);
      assert.match(summary, /live 💰 \$1\.2500/);
      assert.match(summary, /\[blocked\] task-b → architect/);
      assert.match(summary, /blocked: waiting for answer/);
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
