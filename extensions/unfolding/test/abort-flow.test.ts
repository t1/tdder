import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderAbortSummary, abortAllActiveSessions, abortSessionStack } from "../abort-flow.ts";
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
      assert.match(summary, /live \$1\.25 \(↑12 ↓34\)/);
      assert.match(summary, /\[in_progress\] task-b → architect/);
      assert.match(summary, /live \$0\.75 \(↑10 ↓20\)/);
      assert.match(summary, /\[blocked\] task-c → coder/);
      assert.match(summary, /blocked: waiting for answer/);
      assert.match(summary, /live \$0\.50 \(↑8 ↓13\)/);
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

  it("does not wait for aborting the already-aborted child or ancestor commissioners of the current nested commissioner session", async () => {
    const { cwd } = makeTestGitRepo("abort-flow");
    try {
      createTask(cwd, {
        slug: "po-1",
        from: "orchestrator",
        to: "po",
        body: "Do PO work",
      });
      createTask(cwd, {
        slug: "arch-1",
        from: "po",
        to: "architect",
        body: "Do Architect work",
        parent_slug: "po-1",
      });
      createTask(cwd, {
        slug: "code-1",
        from: "architect",
        to: "coder",
        body: "Do Coder work",
        parent_slug: "arch-1",
      });

      let childAborted = false;
      const activeSessions = new Map<string, any>([
        ["po-1", {
          abort: () => new Promise(() => {}),
          getSessionStats: () => ({ cost: 0, tokens: { input: 0, output: 0 } }),
        }],
        ["arch-1", {
          abort: () => new Promise(() => {}),
          getSessionStats: () => ({ cost: 0, tokens: { input: 0, output: 0 } }),
        }],
        ["code-1", {
          abort: async () => { childAborted = true; },
          getSessionStats: () => ({ cost: 0, tokens: { input: 0, output: 0 } }),
        }],
      ]);

      const outcome = await Promise.race([
        (abortSessionStack as any)(cwd, "task \"code-1\" was aborted", activeSessions as any, undefined, { skipSlugs: new Set(["code-1", "arch-1"]) })
          .then(() => "resolved"),
        new Promise<string>(resolve => setTimeout(() => resolve("timeout"), 50)),
      ]);

      assert.equal(childAborted, false, "the already-aborted child should not be awaited or aborted again");
      assert.equal(outcome, "resolved", "stack abort should not hang on the already-aborted child, the current commissioner, or its ancestors");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});
