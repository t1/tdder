import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildConnectOptions, launchInTmux } from "../connect-session.ts";
import type { Task } from "../task-store.ts";

function makeTask(slug: string, to: string, sessionFile: string, status: Task["status"] = "in_progress"): Task {
  return { slug, from: "orchestrator", to, body: "work", status, session_file: sessionFile };
}

describe("connect-session", () => {
  describe("buildConnectOptions", () => {
    it("returns one entry per task with role+slug+status label, commissioner last", () => {
      const options = buildConnectOptions(
        [
          makeTask("po-1", "po", "/sessions/po-1.jsonl"),
          makeTask("arch-1", "architect", "/sessions/arch-1.jsonl", "blocked"),
        ],
        "/sessions/root.jsonl",
      );

      assert.deepEqual(options, [
        { label: "[po] po-1 (in_progress)", slug: "po-1", role: "po", sessionFile: "/sessions/po-1.jsonl" },
        { label: "[architect] arch-1 (blocked)", slug: "arch-1", role: "architect", sessionFile: "/sessions/arch-1.jsonl" },
        { label: "Stay here (root session)", slug: "", role: "", sessionFile: "/sessions/root.jsonl" },
      ]);
    });

    it("omits the commissioner entry when sessionFile is undefined", () => {
      const options = buildConnectOptions(
        [makeTask("po-1", "po", "/sessions/po-1.jsonl")],
        undefined,
      );

      assert.equal(options.length, 1);
      assert.equal(options[0].slug, "po-1");
    });

    it("returns an empty list when there are no tasks and no commissioner", () => {
      const options = buildConnectOptions([], undefined);
      assert.deepEqual(options, []);
    });
  });

  describe("launchInTmux", () => {
    it("runs tmux new-window with the session file when inside tmux", async () => {
      const calls: Array<{ cmd: string; args: string[] }> = [];
      const result = await launchInTmux(
        { label: "[coder] code-1 (in_progress)", slug: "code-1", sessionFile: "/s/code-1.jsonl" },
        async (cmd, args) => { calls.push({ cmd, args }); return { code: 0 }; },
        "/tmp/tmux-socket",
      );

      assert.equal(result.launched, true);
      assert.equal(result.fallbackCommand, undefined);
      assert.deepEqual(calls, [
        { cmd: "tmux", args: ["new-window", "-n", "code-1", "pi --session /s/code-1.jsonl"] },
      ]);
    });

    it("returns a fallback command and does not exec when not inside tmux", async () => {
      const calls: Array<unknown> = [];
      const result = await launchInTmux(
        { label: "[coder] code-1 (in_progress)", slug: "code-1", sessionFile: "/s/code-1.jsonl" },
        async (...args) => { calls.push(args); return { code: 0 }; },
        undefined,
      );

      assert.equal(result.launched, false);
      assert.equal(result.fallbackCommand, "pi --session /s/code-1.jsonl");
      assert.equal(calls.length, 0);
    });

    it("uses 'root' as the window name for the commissioner option (empty slug)", async () => {
      const calls: Array<{ cmd: string; args: string[] }> = [];
      await launchInTmux(
        { label: "Stay here (root session)", slug: "", sessionFile: "/s/root.jsonl" },
        async (cmd, args) => { calls.push({ cmd, args }); return { code: 0 }; },
        "/tmp/tmux-socket",
      );

      assert.deepEqual(calls[0].args[2], "root");
    });
  });
});
