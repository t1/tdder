import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {createTask, readTask} from "../task-store.ts";
import {cleanupTestTempDir, makeTestTempDir} from "./test-temp.ts";
import {installCheckpointRecovery} from "../task-delegate.ts";

describe("installCheckpointRecovery auto-retry handling", () => {
  it("does not fail a child while pi is retrying and the retry later succeeds", () => {
    const cwd = makeTestTempDir("checkpoint-retry");
    let captured: ((e: any) => void) | undefined;
    const prompted: string[] = [];
    const notes: string[] = [];
    const fakeSession = {
      subscribe: (handler: any) => {
        captured = handler;
        return () => {};
      },
      prompt: async (message: string) => {
        prompted.push(message);
      },
    } as any;

    try {
      createTask(cwd, { slug: "arch-retry", from: "po", to: "architect", body: "Do work" });
      const recovery = installCheckpointRecovery(fakeSession, cwd, "arch-retry", {
        onRecoveryNote: (line) => notes.push(line),
      });

      captured!({
        type: "message_end",
        message: { role: "assistant", stopReason: "error", errorMessage: "503 Model server connection error", content: [] },
      });
      captured!({
        type: "agent_end",
        messages: [],
        willRetry: true,
      });
      captured!({
        type: "turn_end",
        message: { role: "assistant", stopReason: "error" },
        toolResults: [],
      });

      assert.equal(recovery.getFatalError(), undefined, "retrying child must not be marked fatal");
      assert.equal(prompted.length, 0, "retrying child must not trigger missing-checkpoint recovery");
      assert.equal(notes.length, 0, "retrying child must not emit failure notes yet");

      captured!({
        type: "auto_retry_end",
        success: true,
        attempt: 1,
      });
      captured!({
        type: "message_end",
        message: { role: "assistant", stopReason: "toolUse", content: [] },
      });
      captured!({
        type: "turn_end",
        message: { role: "assistant", stopReason: "toolUse" },
        toolResults: [],
      });

      assert.equal(recovery.getFatalError(), undefined, "successful retry must clear pending terminal failure");
      assert.equal(readTask(cwd, "arch-retry")?.status, "in_progress");

      recovery.unsubscribe();
    } finally {
      cleanupTestTempDir(cwd);
    }
  });

  it("fails a child only after pi reports retry exhaustion", () => {
    const cwd = makeTestTempDir("checkpoint-retry");
    let captured: ((e: any) => void) | undefined;
    const prompted: string[] = [];
    const notes: string[] = [];
    const fakeSession = {
      subscribe: (handler: any) => {
        captured = handler;
        return () => {};
      },
      prompt: async (message: string) => {
        prompted.push(message);
      },
    } as any;

    try {
      createTask(cwd, { slug: "arch-retry-fail", from: "po", to: "architect", body: "Do work" });
      const recovery = installCheckpointRecovery(fakeSession, cwd, "arch-retry-fail", {
        onRecoveryNote: (line) => notes.push(line),
      });

      captured!({
        type: "message_end",
        message: { role: "assistant", stopReason: "error", errorMessage: "503 Model server connection error", content: [] },
      });
      captured!({
        type: "agent_end",
        messages: [],
        willRetry: true,
      });
      captured!({
        type: "auto_retry_end",
        success: false,
        attempt: 3,
        finalError: "503 Model server connection error",
      });

      const fatal = recovery.getFatalError();
      assert.ok(fatal, "retry exhaustion must become fatal");
      assert.match(fatal?.message ?? "", /fatal child session error in "arch-retry-fail": 503 Model server connection error/);
      assert.equal(prompted.length, 0, "fatal retry exhaustion must not be treated as missing checkpoint");
      assert.equal(notes.length, 1, "fatal retry exhaustion should emit one failure note");
      assert.match(notes[0] ?? "", /child session failed before a checkpoint — 503 Model server connection error/);

      recovery.unsubscribe();
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});
