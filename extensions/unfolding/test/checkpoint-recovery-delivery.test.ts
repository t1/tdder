/**
 * Tests for checkpoint-recovery prompt delivery and loop shutdown.
 *
 * Bug #3: recovery prompts must be awaited (not fire-and-forget) so the enqueue
 *   happens deterministically before the handler returns.
 * Bug #1: recovery must clear competing follow-ups (e.g. Quarkus crash messages
 *   queued during the turn) before queuing the recovery prompt, so the recovery
 *   is not starved by one-at-a-time drain.
 * Bug #2: when the recovery blocks the child task, it must clear the follow-up
 *   queue so the agent loop stops instead of draining stale messages for minutes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTask, readTask } from "../task-store.ts";
import { cleanupTestTempDir, makeTestTempDir } from "./test-temp.ts";
import { installCheckpointRecovery } from "../task-delegate.ts";

const src = readFileSync(resolve(import.meta.dirname, "../task-delegate.ts"), "utf8");

describe("Bug #3 — recovery prompts are awaited", () => {
  it("the truncation recovery prompt is awaited, not fire-and-forget", () => {
    const idx = src.indexOf("queueRecoveryPrompt(TRUNCATION_RECOVERY_PROMPT");
    assert.ok(idx >= 0, "truncation recovery prompt call not found");
    const line = src.slice(src.lastIndexOf("\n", idx) + 1, idx);
    assert.ok(
      line.includes("await "),
      `truncation recovery prompt must be awaited, got:\n${line}`,
    );
  });
  it("the missing-checkpoint recovery prompt is awaited, not fire-and-forget", () => {
    const idx = src.indexOf("queueRecoveryPrompt(MISSING_CHECKPOINT_RECOVERY_PROMPT");
    assert.ok(idx >= 0, "missing-checkpoint recovery prompt call not found");
    const line = src.slice(src.lastIndexOf("\n", idx) + 1, idx);
    assert.ok(
      line.includes("await "),
      `missing-checkpoint recovery prompt must be awaited, got:\n${line}`,
    );
  });
});

describe("Bug #1 — recovery clears competing follow-ups before queuing", () => {
  it("clears the queue before queuing the missing-checkpoint recovery prompt", () => {
    const cwd = makeTestTempDir("recovery-clear");
    let captured: ((e: any) => void) | undefined;
    const calls: string[] = [];
    const fakeSession = {
      subscribe: (handler: any) => { captured = handler; return () => {}; },
      clearQueue: () => { calls.push("clearQueue"); return {steering: [], followUp: []}; },
      prompt: async (message: string) => { calls.push("prompt:" + message.slice(0, 20)); },
    } as any;

    try {
      createTask(cwd, { slug: "po-root", from: "orchestrator", to: "po", body: "Root" });
      createTask(cwd, { slug: "arch-clear", from: "po", to: "architect", body: "Do work", parent_slug: "po-root" });
      const recovery = installCheckpointRecovery(fakeSession, cwd, "arch-clear");

      captured!({ type: "turn_end", message: { role: "assistant", stopReason: "stop" }, toolResults: [] });

      assert.ok(calls.includes("clearQueue"), `must clear queue before recovery, got: ${calls}`);
      assert.ok(calls.some((c) => c.startsWith("prompt:")), `must queue recovery prompt, got: ${calls}`);

      recovery.unsubscribe();
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
  it("clears the queue before queuing the truncation recovery prompt", () => {
    const cwd = makeTestTempDir("recovery-clear-trunc");
    let captured: ((e: any) => void) | undefined;
    const calls: string[] = [];
    const fakeSession = {
      subscribe: (handler: any) => { captured = handler; return () => {}; },
      clearQueue: () => { calls.push("clearQueue"); return {steering: [], followUp: []}; },
      prompt: async (message: string) => { calls.push("prompt:" + message.slice(0, 20)); },
    } as any;

    try {
      createTask(cwd, { slug: "po-root", from: "orchestrator", to: "po", body: "Root" });
      createTask(cwd, { slug: "arch-trunc", from: "po", to: "architect", body: "Do work", parent_slug: "po-root" });
      const recovery = installCheckpointRecovery(fakeSession, cwd, "arch-trunc");

      captured!({ type: "message_end", message: { role: "assistant", stopReason: "length", content: [] } });
      captured!({ type: "turn_end", message: { role: "assistant", stopReason: "length" }, toolResults: [] });

      assert.ok(calls.includes("clearQueue"), `must clear queue before recovery, got: ${calls}`);
      assert.ok(calls.some((c) => c.startsWith("prompt:")), `must queue recovery prompt, got: ${calls}`);
      assert.ok(
        calls.indexOf("clearQueue") < calls.findIndex((c) => c.startsWith("prompt:")),
        `clearQueue must come before prompt, got: ${calls}`,
      );

      recovery.unsubscribe();
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});

describe("Bug #2 — block clears the queue to stop the agent loop", () => {
  it("clears the queue when blocking after repeated missing checkpoints", () => {
    const cwd = makeTestTempDir("block-clear");
    let captured: ((e: any) => void) | undefined;
    const calls: string[] = [];
    const fakeSession = {
      subscribe: (handler: any) => { captured = handler; return () => {}; },
      clearQueue: () => { calls.push("clearQueue"); return {steering: [], followUp: []}; },
      prompt: async (message: string) => { calls.push("prompt:" + message.slice(0, 20)); },
    } as any;

    try {
      createTask(cwd, { slug: "po-root", from: "orchestrator", to: "po", body: "Root" });
      createTask(cwd, { slug: "arch-block", from: "po", to: "architect", body: "Do work", parent_slug: "po-root" });
      const recovery = installCheckpointRecovery(fakeSession, cwd, "arch-block");

      // First missing checkpoint → recovery prompt (clears + prompts)
      captured!({ type: "turn_end", message: { role: "assistant", stopReason: "stop" }, toolResults: [] });
      calls.length = 0; // reset after recovery

      // Second missing checkpoint → block (must clear queue to stop loop)
      captured!({ type: "turn_end", message: { role: "assistant", stopReason: "stop" }, toolResults: [] });

      assert.equal(readTask(cwd, "arch-block")?.status, "blocked", "task must be blocked");
      assert.ok(calls.includes("clearQueue"), `block must clear queue to stop loop, got: ${calls}`);

      recovery.unsubscribe();
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
  it("clears the queue when blocking after repeated truncation", () => {
    const cwd = makeTestTempDir("block-clear-trunc");
    let captured: ((e: any) => void) | undefined;
    const calls: string[] = [];
    const fakeSession = {
      subscribe: (handler: any) => { captured = handler; return () => {}; },
      clearQueue: () => { calls.push("clearQueue"); return {steering: [], followUp: []}; },
      prompt: async (message: string) => { calls.push("prompt:" + message.slice(0, 20)); },
    } as any;

    try {
      createTask(cwd, { slug: "po-root", from: "orchestrator", to: "po", body: "Root" });
      createTask(cwd, { slug: "arch-block-trunc", from: "po", to: "architect", body: "Do work", parent_slug: "po-root" });
      const recovery = installCheckpointRecovery(fakeSession, cwd, "arch-block-trunc");

      // First truncation → recovery prompt
      captured!({ type: "message_end", message: { role: "assistant", stopReason: "length", content: [] } });
      captured!({ type: "turn_end", message: { role: "assistant", stopReason: "length" }, toolResults: [] });
      calls.length = 0;

      // Second truncation → block (must clear queue to stop loop)
      captured!({ type: "message_end", message: { role: "assistant", stopReason: "length", content: [] } });
      captured!({ type: "turn_end", message: { role: "assistant", stopReason: "length" }, toolResults: [] });

      assert.equal(readTask(cwd, "arch-block-trunc")?.status, "blocked", "task must be blocked");
      assert.ok(calls.includes("clearQueue"), `block must clear queue to stop loop, got: ${calls}`);

      recovery.unsubscribe();
    } finally {
      cleanupTestTempDir(cwd);
    }
  });
});
