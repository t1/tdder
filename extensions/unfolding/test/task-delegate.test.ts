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
// waitForChildDecision
// ---------------------------------------------------------------------------

describe("waitForChildDecision", () => {
  it("resolves 'finished' when task status becomes finished", async () => {
    const sequence = ["in_progress", "in_progress", "finished"];
    let i = 0;
    const readStatus = async () => sequence[Math.min(i++, sequence.length - 1)];
    const result = await waitForChildDecision(readStatus, 0);
    assert.equal(result, "finished");
  });

  it("resolves 'blocked' when task status becomes blocked", async () => {
    const sequence = ["in_progress", "blocked"];
    let i = 0;
    const readStatus = async () => sequence[Math.min(i++, sequence.length - 1)];
    const result = await waitForChildDecision(readStatus, 0);
    assert.equal(result, "blocked");
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
