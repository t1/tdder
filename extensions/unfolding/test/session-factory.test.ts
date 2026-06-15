import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startChildSession, readTaskSnapshot } from "../session-factory.ts";
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

describe("startChildSession groundwork", () => {
  it("creates a task with session_file persisted", async () => {
    const cwd = makeTestTempDir("session-factory");
    try {
      const resultPromise = startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-task",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions: new Map() as any,
        pi: {} as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
      });

      const deadline = Date.now() + 10000;
      let snapshot = null;
      while (Date.now() < deadline) {
        snapshot = readTaskSnapshot(cwd, "coder-task");
        if (snapshot?.session_file) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      assert.ok(snapshot, "task should exist");
      assert.ok(snapshot?.session_id, "task should persist session_id");
      assert.ok(snapshot?.session_file, "task should persist session_file");

      const result = await resultPromise;
      assert.equal(result.outcome, "blocked");
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("restores from the real persisted session_file created by startChildSession", async () => {
    const cwd = makeTestTempDir("session-factory");
    try {
      const activeSessions = new Map() as any;
      const { session, outcome } = await startChildSession({
        cwd,
        from: "orchestrator",
        role: "coder",
        slug: "coder-restore",
        body: "Call task_block with blocked_reason 'need input'. Just call the tool, nothing else.",
        activeSessions,
        pi: {} as any,
        postOutput: () => {},
        nestedDelegateToolFactory,
      });

      assert.equal(outcome, "blocked");
      const snapshot = readTaskSnapshot(cwd, "coder-restore");
      assert.ok(snapshot?.session_file, "task should persist session_file");

      activeSessions.delete("coder-restore");
      const restored = await restoreChildSession(cwd, "coder-restore", activeSessions, {} as any, () => {}, nestedDelegateToolFactory);
      assert.ok(restored, "restoreChildSession should restore a real persisted child session");
      assert.equal(restored?.sessionFile, snapshot?.session_file);
      assert.equal(restored?.sessionManager.getSessionFile(), snapshot?.session_file);
      assert.equal(session.sessionFile, snapshot?.session_file);
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("source contains nestedDelegateToolFactory seam", () => {
    const src = readFileSync(new URL("../session-factory.ts", import.meta.url).pathname, "utf8");
    assert.ok(src.includes("nestedDelegateToolFactory"));
  });
});
