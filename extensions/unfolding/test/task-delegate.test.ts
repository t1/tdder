/**
 * Tests for task_delegate mechanics:
 * - agent file loading
 * - bidirectional polling (waitForChildDecision, waitForResume)
 * - structural invariants
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadAgentSystemPrompt,
  streamChildSession,
  waitForChildDecision,
  waitForResume,
} from "../task-delegate.ts";

const rolesDir = resolve(new URL("../roles", import.meta.url).pathname);

// ---------------------------------------------------------------------------
// loadAgentSystemPrompt
// ---------------------------------------------------------------------------

describe("loadAgentSystemPrompt", () => {
  it("loads and strips frontmatter from roles/po.md", () => {
    const prompt = loadAgentSystemPrompt(rolesDir, "po");
    assert.ok(prompt !== null, "should load the po agent file");
    assert.ok(!prompt.startsWith("---"), "frontmatter must be stripped");
    assert.ok(prompt.includes("Product Owner") || prompt.includes("PO"), "body content must be present");
  });

  it("returns null for an unknown role", () => {
    assert.equal(loadAgentSystemPrompt(rolesDir, "nonexistent-role"), null);
  });
});

// ---------------------------------------------------------------------------
// streamChildSession
// ---------------------------------------------------------------------------

describe("streamChildSession", () => {
  it("emits initial flush immediately on subscribe", () => {
    const updates: string[] = [];
    const fakeSession = {
      subscribe: (_handler: unknown) => () => {},
    } as any;
    streamChildSession(fakeSession, "po", "test-slug", (update: any) => {
      updates.push(update.content[0].text);
    });
    assert.equal(updates.length, 1);
    assert.ok(updates[0].includes("[po/test-slug]"));
  });

  it("appends tool name on tool_execution_start", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = { subscribe: (h: any) => { captured = h; return () => {}; } } as any;
    streamChildSession(fakeSession, "architect", "slug", (u: any) => updates.push(u.content[0].text));
    captured!({ type: "tool_execution_start", toolCallId: "x", toolName: "read", args: {} });
    const last = updates[updates.length - 1];
    assert.ok(last.includes("[architect] ⚙ read"), `expected tool line, got: ${last}`);
  });

  it("accumulates text_delta onto a single line", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = { subscribe: (h: any) => { captured = h; return () => {}; } } as any;
    streamChildSession(fakeSession, "coder", "slug", (u: any) => updates.push(u.content[0].text));
    captured!({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello" } });
    captured!({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " world" } });
    const last = updates[updates.length - 1];
    assert.ok(last.includes("[coder] 💬 Hello world"), `expected accumulated text, got: ${last}`);
  });

  it("returns unsubscribe function that removes the listener", () => {
    let unsubscribeCalled = false;
    const fakeSession = { subscribe: (_h: any) => () => { unsubscribeCalled = true; } } as any;
    const { unsubscribe } = streamChildSession(fakeSession, "po", "slug", () => {});
    unsubscribe();
    assert.ok(unsubscribeCalled);
  });

  it("append adds a line and flushes", () => {
    const updates: string[] = [];
    const fakeSession = { subscribe: (_h: any) => () => {} } as any;
    const { append } = streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text));
    append("  ⏸ blocked: need help");
    const last = updates[updates.length - 1];
    assert.ok(last.includes("⏸ blocked: need help"), `expected blocked line, got: ${last}`);
  });
});

// ---------------------------------------------------------------------------
// waitForChildDecision
// ---------------------------------------------------------------------------

describe("waitForChildDecision", () => {
  it("resolves 'finished' when task status becomes finished", async () => {
    const sequence = ["in_progress", "in_progress", "finished"];
    let i = 0;
    const readStatus = async () => ({ status: sequence[Math.min(i++, sequence.length - 1)] });
    const result = await waitForChildDecision(readStatus, undefined, 0);
    assert.equal(result, "finished");
  });

  it("resolves 'blocked' when task status becomes blocked", async () => {
    const sequence = ["in_progress", "blocked"];
    let i = 0;
    const readStatus = async () => ({ status: sequence[Math.min(i++, sequence.length - 1)] });
    const result = await waitForChildDecision(readStatus, undefined, 0);
    assert.equal(result, "blocked");
  });

  it("calls onPoll with status and blocked_reason when blocked", async () => {
    const polls: Array<{ status: string; reason?: string }> = [];
    const sequence = [{ status: "in_progress" }, { status: "blocked", blocked_reason: "need help" }];
    let i = 0;
    const readStatus = async () => sequence[Math.min(i++, sequence.length - 1)];
    await waitForChildDecision(readStatus, (s, r) => polls.push({ status: s, reason: r }), 0);
    assert.equal(polls.length, 1);
    assert.equal(polls[0].status, "blocked");
    assert.equal(polls[0].reason, "need help");
  });
});

// ---------------------------------------------------------------------------
// waitForResume
// ---------------------------------------------------------------------------

describe("waitForResume", () => {
  it("resolves 'accepted' when task file is deleted (readStatus returns null)", async () => {
    const sequence = ["finished", "finished", null] as const;
    let i = 0;
    const readStatus = async () => (sequence[Math.min(i++, sequence.length - 1)] as string | null);
    const result = await waitForResume(readStatus as any, 0);
    assert.equal(result.outcome, "accepted");
    assert.equal(result.message, "accepted. you can close your session now");
  });

  it("resolves 'in_progress' with resume_message from file", async () => {
    const sequence = [
      { status: "finished",    resume_message: undefined },
      { status: "in_progress", resume_message: "reopened: try harder" },
    ];
    let i = 0;
    const readStatus = async () => sequence[Math.min(i++, sequence.length - 1)] as { status: string; resume_message?: string } | null;
    const result = await waitForResume(readStatus as any, 0);
    assert.equal(result.outcome, "in_progress");
    assert.equal(result.message, "reopened: try harder");
  });
});

// ---------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------

describe("structural invariants", () => {
  it("task_delegate tool calls ensureGitignore before creating the task", () => {
    const src = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");
    const delegateIdx = src.indexOf('name: "task_delegate"');
    assert.ok(delegateIdx >= 0, 'task_delegate tool must be registered');
    const executeIdx = src.indexOf("async execute", delegateIdx);
    const executeBlock = src.slice(executeIdx, executeIdx + 600);
    assert.ok(executeBlock.includes("ensureGitignore"), "task_delegate execute must call ensureGitignore");
  });

  it("task_delegate appends a fixed instruction to the child's initial message", () => {
    const src = readFileSync(new URL("../task-delegate.ts", import.meta.url).pathname, "utf8");
    assert.ok(
      src.includes("CHILD_FIXED_INSTRUCTION"),
      "task-delegate.ts must export CHILD_FIXED_INSTRUCTION",
    );
    assert.ok(
      src.includes("task_finished") && src.includes("task_block"),
      "CHILD_FIXED_INSTRUCTION must mention task_finished and task_block",
    );
  });
});
