/**
 * Integration test: file-based polling coordination between task_finished and task_accept.
 *
 * Starts pi in RPC mode with the unfolding extension, uses the RPC `bash` command
 * to create a task file directly (bypassing the LLM), then sends two concurrent
 * prompts — one to call task_finished (which blocks polling) and one to call
 * task_accept (which deletes the file) — and verifies that task_finished resolves
 * with "accepted".
 *
 * Run with:
 *   node --test test/integration.test.ts
 *
 * Requires a configured LLM provider (uses whatever pi defaults to).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { makeTestTempDir, cleanupTestTempDir } from "./test-temp.ts";

const EXTENSION_PATH = resolve(new URL("../index.ts", import.meta.url).pathname);
const TIMEOUT_MS = 60_000;

interface RpcEvent { type: string; [key: string]: unknown }

function startPi(cwd: string): {
  proc: ChildProcess;
  send: (cmd: object) => void;
  nextEvent: () => Promise<RpcEvent>;
} {
  const proc = spawn("pi", ["--mode", "rpc", "--no-session", "-e", EXTENSION_PATH], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stderr?.on("data", (_d: Buffer) => { /* suppress */ });

  function send(cmd: object): void {
    proc.stdin!.write(JSON.stringify(cmd) + "\n");
  }

  const queue: RpcEvent[] = [];
  const waiters: Array<(e: RpcEvent) => void> = [];
  let buffer = "";

  proc.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as RpcEvent;
        const waiter = waiters.shift();
        if (waiter) waiter(event);
        else queue.push(event);
      } catch { /* skip malformed */ }
    }
  });

  function nextEvent(): Promise<RpcEvent> {
    if (queue.length > 0) return Promise.resolve(queue.shift()!);
    return new Promise(resolve => waiters.push(resolve));
  }

  return { proc, send, nextEvent };
}

async function waitFor(
  nextEvent: () => Promise<RpcEvent>,
  predicate: (e: RpcEvent) => boolean,
  timeoutMs = TIMEOUT_MS,
): Promise<RpcEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = await Promise.race([
      nextEvent(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), deadline - Date.now())),
    ]);
    if (event === null) break;
    if (predicate(event)) return event;
  }
  throw new Error(`Timed out waiting for event (predicate: ${predicate.toString().slice(0, 80)})`);
}

async function waitForReady(
  send: (cmd: object) => void,
  nextEvent: () => Promise<RpcEvent>,
): Promise<void> {
  send({ id: "ready-probe", type: "get_state" });
  await waitFor(nextEvent, e => e.type === "response" && (e as { command?: string }).command === "get_state", 10_000);
}

function writeTaskFile(cwd: string, slug: string): void {
  const dir = join(cwd, ".pi/unfolding/tasks");
  mkdirSync(dir, { recursive: true });
  const content = [
    `slug: ${slug}`,
    `status: in_progress`,
    `from: orchestrator`,
    `to: po`,
    `body: |`,
    `  test task body`,
  ].join("\n") + "\n";
  writeFileSync(join(dir, randomUUID() + ".yaml"), content);
}

describe("task_finished + task_accept coordination", { timeout: TIMEOUT_MS }, () => {
  let cwd: string;
  before(() => { cwd = makeTestTempDir("unfolding-integration"); });
  after(() => { cleanupTestTempDir(cwd); });

  it("task_finished resolves with 'accepted' after task_accept deletes the file", async () => {
    const slug = "test-coordination-" + randomUUID().slice(0, 8);
    writeTaskFile(cwd, slug);

    const piA = startPi(cwd);
    await waitForReady(piA.send, piA.nextEvent);

    piA.send({ id: "req-finished", type: "prompt", message: `Call task_finished with slug "${slug}". Just call the tool, nothing else.` });
    await waitFor(piA.nextEvent, e =>
      e.type === "tool_execution_start" && e.toolName === "task_finished",
    );

    const piB = startPi(cwd);
    await waitForReady(piB.send, piB.nextEvent);

    piB.send({ id: "req-accept", type: "prompt", message: `Call task_accept with slug "${slug}". Just call the tool, nothing else.` });
    await waitFor(piB.nextEvent, e => e.type === "agent_end");
    piB.proc.kill();

    const endEvent = await waitFor(piA.nextEvent, e => e.type === "agent_end");
    piA.proc.kill();

    const messages = (endEvent as { messages?: Array<{ role: string; content: Array<{ type: string; text?: string }> }> }).messages ?? [];
    const toolResults = messages.filter(m => m.role === "toolResult");
    const finishedResult = toolResults.find(m =>
      m.content?.some(c => c.type === "text" && c.text?.includes("accepted")),
    );
    assert.ok(finishedResult, "task_finished tool result must mention 'accepted'");
  });
});

describe("/unfold command smoke test", { timeout: 90_000 }, () => {
  let cwd: string;
  before(() => { cwd = makeTestTempDir("unfolding-smoke"); });
  after(() => { cleanupTestTempDir(cwd); });

  it("injects orchestrator skill and registers task_delegate tool", async () => {
    const instance = startPi(cwd);
    await waitForReady(instance.send, instance.nextEvent);

    instance.send({ id: "unfold-cmd", type: "prompt", message: "/unfold" });
    await waitFor(instance.nextEvent, e => e.type === "agent_end", 60_000);

    instance.send({
      id: "list-tools",
      type: "prompt",
      message: "List the names of every tool available to you, one per line. Do not call any tool.",
    });

    let fullText = "";
    await waitFor(instance.nextEvent, e => {
      if (e.type === "message_update") {
        const ae = (e as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
        if (ae?.type === "text_delta" && ae.delta) fullText += ae.delta;
      }
      return e.type === "agent_end";
    }, 60_000);

    instance.proc.kill();

    assert.ok(
      fullText.includes("task_delegate"),
      `Expected task_delegate in tool listing, got:\n${fullText.slice(0, 800)}`,
    );
  });
});
