import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import initUnfolding from "../index.ts";
import { createTask, updateTaskStatus, readTask } from "../task-store.ts";
import { createSnapshotCommit } from "../git-task-state.ts";
import { cleanupTestTempDir } from "./test-temp.ts";
import { makeTestGitRepo } from "./test-git-repo.ts";

function setupPi(activeSessions?: Map<string, any>) {
  const tools = new Map<string, any>();
  const pi = {
    on() {},
    registerMessageRenderer() {},
    registerCommand() {},
    registerTool(def: any) { tools.set(def.name, def); },
    sendMessage() {},
    sendUserMessage() {},
  };
  initUnfolding(pi as any, { activeSessions } as any);
  return { tools };
}

describe("registered task tools", () => {
  it("task_rollback tool rolls back a finished task", async () => {
    const { cwd, head: baseSha } = makeTestGitRepo("index-tools");
    try {
      writeFileSync(join(cwd, "docs", "README.md"), "seed\npre-task dirty\n");
      writeFileSync(join(cwd, "notes.txt"), "untracked before delegate\n");
      const snapshotSha = createSnapshotCommit(cwd);

      createTask(cwd, {
        slug: "rollback-finished",
        from: "orchestrator",
        to: "po",
        body: "Done",
        base_sha: baseSha,
        snapshot_sha: snapshotSha,
      });
      updateTaskStatus(cwd, "rollback-finished", "finished");

      writeFileSync(join(cwd, "docs", "README.md"), "seed\ntask changed\n");
      writeFileSync(join(cwd, "task-temp.txt"), "created by task\n");

      const { tools } = setupPi();
      const tool = tools.get("task_rollback");
      assert.ok(tool, "task_rollback tool must be registered");

      const result = await tool.execute("1", { slug: "rollback-finished" }, undefined, undefined, { cwd });

      assert.equal(result.content[0].text, 'Task "rollback-finished" rolled back.');
      assert.equal(readTask(cwd, "rollback-finished"), null);
      assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(), baseSha);
      assert.equal(readFileSync(join(cwd, "docs", "README.md"), "utf8"), "seed\npre-task dirty\n");
      assert.equal(readFileSync(join(cwd, "notes.txt"), "utf8"), "untracked before delegate\n");
      assert.equal(existsSync(join(cwd, "task-temp.txt")), false);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("task_rollback tool aborts a live in-progress session before rollback", async () => {
    const { cwd, head: baseSha } = makeTestGitRepo("index-tools");
    try {
      const activeSessions = new Map<string, any>();
      let aborted = false;
      activeSessions.set("rollback-live", {
        abort: async () => { aborted = true; },
      });

      createTask(cwd, {
        slug: "rollback-live",
        from: "orchestrator",
        to: "po",
        body: "In progress",
        base_sha: baseSha,
      });

      writeFileSync(join(cwd, "docs", "README.md"), "seed\ntask changed\n");
      const { tools } = setupPi(activeSessions);
      const tool = tools.get("task_rollback");
      assert.ok(tool, "task_rollback tool must be registered");

      await tool.execute("1", { slug: "rollback-live" }, undefined, undefined, { cwd });

      assert.equal(aborted, true, "live child session should be aborted");
      assert.equal(activeSessions.has("rollback-live"), false, "live session handle should be removed");
      assert.equal(readTask(cwd, "rollback-live"), null);
      assert.equal(readFileSync(join(cwd, "docs", "README.md"), "utf8"), "seed\n");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});
