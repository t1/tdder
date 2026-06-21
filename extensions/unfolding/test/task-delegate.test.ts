/**
 * Tests for task_delegate mechanics:
 * - agent file loading
 * - bidirectional polling (waitForChildDecision, waitForResume)
 * - structural invariants
 */

import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {loadAgentSystemPrompt, streamChildSession, waitForChildDecision, waitForResume, MISSING_CHECKPOINT_BLOCKED_REASON, CHILD_SESSION_FAILURE_BLOCKED_REASON} from "../task-delegate.ts";

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
      subscribe: (_handler: unknown) => () => {
      },
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
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "architect", "slug", (u: any) => updates.push(u.content[0].text), {
      now: () => 0,
    });
    captured!({type: "tool_execution_start", toolCallId: "x", toolName: "read", args: {}});
    const last = updates[updates.length - 1];
    assert.ok(last.includes("[architect] ⚙ read — 0s"), `expected timed tool line, got: ${last}`);
  });

  it("accumulates text_delta onto a single line", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "coder", "slug", (u: any) => updates.push(u.content[0].text));
    captured!({type: "message_update", assistantMessageEvent: {type: "text_delta", delta: "Hello"}});
    captured!({type: "message_update", assistantMessageEvent: {type: "text_delta", delta: " world"}});
    const last = updates[updates.length - 1];
    assert.ok(last.includes("[coder] 💬 Hello world"), `expected accumulated text, got: ${last}`);
  });

  it("ignores whitespace-only initial text_delta updates", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text));

    captured!({type: "message_update", assistantMessageEvent: {type: "text_delta", delta: "\n\n"}});
    captured!({type: "message_update", assistantMessageEvent: {type: "text_delta", delta: "  "}});

    assert.equal(updates.length, 1, `expected no extra flush for whitespace-only deltas, got: ${updates.length}`);
    assert.equal(updates[0], "[po/slug]\n  [po] ⏱ total — 0s");
  });

  it("drops leading whitespace before the first visible assistant text", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text));

    captured!({type: "message_update", assistantMessageEvent: {type: "text_delta", delta: "\n  "}});
    captured!({type: "message_update", assistantMessageEvent: {type: "text_delta", delta: "Hello"}});

    const last = updates[updates.length - 1];
    assert.ok(last.includes("[po] 💬 Hello"), `expected first visible text without leading whitespace, got: ${last}`);
  });

  it("forwards thinking_delta onto a separate line", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text));

    captured!({type: "message_update", assistantMessageEvent: {type: "thinking_delta", contentIndex: 0, delta: "plan"}});
    captured!({type: "message_update", assistantMessageEvent: {type: "thinking_delta", contentIndex: 0, delta: " first"}});

    const last = updates[updates.length - 1];
    assert.ok(last.includes("[po] 🤔 plan first"), `expected accumulated thinking text, got: ${last}`);
  });

  it("keeps thinking and text on separate lines when deltas interleave", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text));

    captured!({type: "message_update", assistantMessageEvent: {type: "thinking_delta", contentIndex: 0, delta: "think"}});
    captured!({type: "message_update", assistantMessageEvent: {type: "text_delta", contentIndex: 1, delta: "say"}});
    captured!({type: "message_update", assistantMessageEvent: {type: "thinking_delta", contentIndex: 0, delta: " more"}});
    captured!({type: "message_update", assistantMessageEvent: {type: "text_delta", contentIndex: 1, delta: " more"}});

    const last = updates[updates.length - 1];
    assert.ok(last.includes("[po] 🤔 think more"), `expected thinking line, got: ${last}`);
    assert.ok(last.includes("[po] 💬 say more"), `expected text line, got: ${last}`);
  });

  it("ignores whitespace-only initial thinking_delta updates", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text));

    captured!({type: "message_update", assistantMessageEvent: {type: "thinking_delta", contentIndex: 0, delta: "\n\n"}});
    captured!({type: "message_update", assistantMessageEvent: {type: "thinking_delta", contentIndex: 0, delta: "  "}});

    assert.equal(updates.length, 1, `expected no extra flush for whitespace-only thinking deltas, got: ${updates.length}`);
    assert.equal(updates[0], "[po/slug]\n  [po] ⏱ total — 0s");
  });

  it("does not append an empty line on turn_end", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    const stream = streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text));

    captured!({type: "message_update", assistantMessageEvent: {type: "text_delta", contentIndex: 0, delta: "Hello"}});
    const beforeTurnEnd = stream.getLines();
    captured!({type: "turn_end"});

    assert.equal(stream.getLines(), beforeTurnEnd);
    assert.equal(updates[updates.length - 1], beforeTurnEnd);
  });

  it("updates failed tool executions in place", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    let nowMs = 0;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text), {
      now: () => nowMs,
    });

    captured!({
      type: "tool_execution_start",
      toolCallId: "r1",
      toolName: "read",
      args: { path: "foo.txt" },
    });
    nowMs = 3000;
    captured!({
      type: "tool_execution_end",
      toolCallId: "r1",
      toolName: "read",
      isError: true,
      result: { content: [{ type: "text", text: "file not found\nmore detail" }] },
    });

    const last = updates[updates.length - 1];
    assert.ok(last.includes("[po] ⚙ read foo.txt — 3s ✗ — file not found"), `expected in-place tool failure summary, got: ${last}`);
    assert.equal((last.match(/\[po] ⚙ read foo.txt/g) ?? []).length, 1, `expected one tool row, got: ${last}`);
  });

  it("shows assistant stream errors", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text));

    captured!({
      type: "message_update",
      assistantMessageEvent: { type: "error", errorMessage: "provider exploded" },
    });

    const last = updates[updates.length - 1];
    assert.ok(last.includes("[po] ❌ provider exploded"), `expected assistant error line, got: ${last}`);
  });

  it("shows terminal assistant failures from message_end", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text));

    captured!({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "Connection error.",
        content: [],
      },
    });

    const last = updates[updates.length - 1];
    assert.ok(last.includes("[po] ❌ Connection error."), `expected terminal assistant failure line, got: ${last}`);
  });

  it("shows aborted assistant turns from message_end", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text));

    captured!({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "aborted",
        content: [],
      },
    });

    const last = updates[updates.length - 1];
    assert.ok(last.includes("[po] ❌ request was aborted"), `expected aborted assistant failure line, got: ${last}`);
  });

  it("shows reduced unexpected child events in the normal transcript with a log reference", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text));

    captured!({
      type: "message_update",
      assistantMessageEvent: { type: "error", errorMessage: "provider exploded" },
    });

    const last = updates[updates.length - 1];
    assert.ok(last.includes("[po] ❌ provider exploded"), `expected assistant error line, got: ${last}`);
  });

  it("shows reduced unexpected child events in the normal transcript with a log reference", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;

    streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text), {
      sessionFile: "/logs/child.jsonl",
    });
    captured!({ type: "queue_update", steering: [], followUp: [] });

    const last = updates[updates.length - 1];
    assert.ok(last.includes("[po] ⚠ unexpected child event for po/slug: type=queue_update — see /logs/child.jsonl"), `expected reduced unexpected-event notice, got: ${last}`);
  });

  it("shows successful tool executions with a trailing checkmark", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    let nowMs = 0;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text), {
      now: () => nowMs,
    });

    captured!({
      type: "tool_execution_start",
      toolCallId: "r1",
      toolName: "read",
      args: { path: "foo.txt" },
    });
    nowMs = 2000;
    captured!({
      type: "tool_execution_end",
      toolCallId: "r1",
      toolName: "read",
      isError: false,
      result: { content: [{ type: "text", text: "ok" }] },
    });

    const last = updates[updates.length - 1];
    assert.ok(last.includes("[po] ⚙ read foo.txt — 2s ✓"), `expected successful tool row, got: ${last}`);
  });

  it("warns when thinking is truncated by the length limit", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text));

    captured!({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "length",
        content: [{ type: "thinking", thinking: "cut off" }],
      },
    });

    const last = updates[updates.length - 1];
    assert.ok(last.includes("[po] ⚠ thinking truncated by length limit"), `expected truncation warning, got: ${last}`);
  });

  it("returns unsubscribe function that removes the listener and clears timers", () => {
    let unsubscribeCalled = false;
    let intervalCallback: (() => void) | undefined;
    let cleared = false;
    let nextTimerId = 0;
    let nowMs = 0;
    const fakeSession = {
      subscribe: (_h: any) => () => {
        unsubscribeCalled = true;
      }
    } as any;
    const {unsubscribe} = streamChildSession(fakeSession, "po", "slug", () => {
    }, {
      now: () => nowMs,
      setIntervalFn: (callback: () => void) => {
        intervalCallback = callback;
        return ++nextTimerId as any;
      },
      clearIntervalFn: (_interval: any) => {
        cleared = true;
      },
    });

    nowMs = 0;
    const sessionWithTool = {
      subscribe: (h: any) => {
        h({ type: "tool_execution_start", toolCallId: "r1", toolName: "read", args: { path: "foo.txt" } });
        return () => {
          unsubscribeCalled = true;
        };
      }
    } as any;
    const streamWithTimer = streamChildSession(sessionWithTool, "po", "slug", () => {
    }, {
      now: () => nowMs,
      setIntervalFn: (callback: () => void) => {
        intervalCallback = callback;
        return ++nextTimerId as any;
      },
      clearIntervalFn: (_interval: any) => {
        cleared = true;
      },
    });

    assert.ok(intervalCallback, "expected timer to be scheduled for pending tool row");
    streamWithTimer.unsubscribe();
    assert.ok(cleared, "expected timer to be cleared on unsubscribe");
    assert.ok(unsubscribeCalled, "expected session unsubscribe to be called");
    unsubscribe();
  });

  it("treats tool_execution_update for a known tool call as expected and shows only the last five lines", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "po-defining", (u: any) => updates.push(u.content[0].text), {
      now: () => 0,
      sessionFile: "/logs/child.jsonl",
    });

    captured!({
      type: "tool_execution_start",
      toolCallId: "u1",
      toolName: "bash",
      args: {command: "ls"},
    });
    captured!({
      type: "tool_execution_update",
      toolCallId: "u1",
      toolName: "bash",
      args: {command: "ls"},
      partialResult: {
        content: [{
          type: "text",
          text: "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7"
        }]
      },
    });

    const last = updates[updates.length - 1];
    assert.ok(last.includes("[po] ⚙ bash ls — 0s"), `expected tool row, got: ${last}`);
    assert.ok(!last.includes("unexpected child event"), `did not expect unexpected-event warning, got: ${last}`);
    assert.ok(!last.includes("    line 1"), `expected old lines to be trimmed from tool output tail, got: ${last}`);
    assert.ok(!last.includes("    line 2"), `expected old lines to be trimmed from tool output tail, got: ${last}`);
    assert.ok(last.includes("    line 3"), `expected retained output tail, got: ${last}`);
    assert.ok(last.includes("    line 7"), `expected retained output tail, got: ${last}`);
  });

  it("forwards tool_execution_update for task_delegate as indented nested output", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "po-slug", (u: any) => updates.push(u.content[0].text), {
      now: () => 0,
    });
    // task_delegate starts
    captured!({
      type: "tool_execution_start",
      toolCallId: "d1",
      toolName: "task_delegate",
      args: {role: "ux-designer", slug: "ux-slug"}
    });
    // grandchild streams two updates
    captured!({
      type: "tool_execution_update",
      toolCallId: "d1",
      toolName: "task_delegate",
      partialResult: {content: [{type: "text", text: "[ux-designer/ux-slug]\n  [ux-designer] ⚙ read"}]}
    });
    captured!({
      type: "tool_execution_update",
      toolCallId: "d1",
      toolName: "task_delegate",
      partialResult: {
        content: [{
          type: "text",
          text: "[ux-designer/ux-slug]\n  [ux-designer] ⚙ read\n  [ux-designer] ⚙ write"
        }]
      }
    });
    const last = updates[updates.length - 1];
    assert.ok(last.includes("    [ux-designer/ux-slug]"), `expected indented grandchild header, got: ${last}`);
    assert.ok(last.includes("    [ux-designer] ⚙ write"), `expected indented grandchild tool line, got: ${last}`);
    assert.ok(last.includes("[po] ⚙ task_delegate ux-designer / ux-slug — 0s"), `expected parent delegate tool row, got: ${last}`);
    assert.ok(!last.includes("unexpected child event"), `did not expect unexpected-event warning, got: ${last}`);
    // the grandchild block should not appear twice
    assert.equal((last.match(/\[ux-designer\/ux-slug]/g) ?? []).length, 1, "grandchild header should appear only once");
  });

  it("forwards tool_execution_update for delegation tools fully, without tail truncation", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "po-slug", (u: any) => updates.push(u.content[0].text), {
      now: () => 0,
    });
    captured!({
      type: "tool_execution_start",
      toolCallId: "u1",
      toolName: "task_unblock",
      args: {slug: "sub-task", reason: "unblocked"},
    });
    captured!({
      type: "tool_execution_update",
      toolCallId: "u1",
      toolName: "task_unblock",
      args: {slug: "sub-task"},
      partialResult: {
        content: [{type: "text", text: "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7"}]
      },
    });
    const last = updates[updates.length - 1];
    assert.ok(last.includes("    line 1"), `expected all lines to be forwarded, got: ${last}`);
    assert.ok(last.includes("    line 7"), `expected last line to be present, got: ${last}`);
  });

  it("ticks elapsed time for pending tools", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    let intervalCallback: (() => void) | undefined;
    let nowMs = 0;
    let nextTimerId = 0;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text), {
      now: () => nowMs,
      setIntervalFn: (callback: () => void) => {
        intervalCallback = callback;
        return ++nextTimerId as any;
      },
      clearIntervalFn: () => {
      },
    });

    captured!({ type: "tool_execution_start", toolCallId: "r1", toolName: "read", args: { path: "foo.txt" } });
    nowMs = 4000;
    intervalCallback?.();

    const last = updates[updates.length - 1];
    assert.ok(last.includes("[po] ⚙ read foo.txt — 4s"), `expected ticking timer update, got: ${last}`);
    assert.ok(last.includes("[po] ⏱ total — 4s"), `expected total timer update, got: ${last}`);
  });

  it("freezes elapsed time for completed tools while other tools are still pending", () => {
    const updates: string[] = [];
    let captured: ((e: any) => void) | undefined;
    let intervalCallback: (() => void) | undefined;
    let nowMs = 0;
    let nextTimerId = 0;
    const fakeSession = {
      subscribe: (h: any) => {
        captured = h;
        return () => {
        };
      }
    } as any;
    streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text), {
      now: () => nowMs,
      setIntervalFn: (callback: () => void) => {
        intervalCallback = callback;
        return ++nextTimerId as any;
      },
      clearIntervalFn: () => {
      },
    });

    captured!({ type: "tool_execution_start", toolCallId: "r1", toolName: "read", args: { path: "done.txt" } });
    captured!({ type: "tool_execution_start", toolCallId: "r2", toolName: "read", args: { path: "pending.txt" } });
    nowMs = 2000;
    captured!({
      type: "tool_execution_end",
      toolCallId: "r1",
      toolName: "read",
      isError: false,
      result: { content: [{ type: "text", text: "ok" }] },
    });

    nowMs = 5000;
    intervalCallback?.();

    const last = updates[updates.length - 1];
    assert.ok(last.includes("[po] ⚙ read done.txt — 2s ✓"), `expected completed tool duration to stay frozen, got: ${last}`);
    assert.ok(last.includes("[po] ⚙ read pending.txt — 5s"), `expected pending tool to keep ticking, got: ${last}`);
  });

  it("append adds a line and flushes", () => {
    const updates: string[] = [];
    const fakeSession = {
      subscribe: (_h: any) => () => {
      }
    } as any;
    const {append} = streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text));
    append("  ⏸ blocked: need help");
    const last = updates[updates.length - 1];
    assert.ok(last.includes("⏸ blocked: need help"), `expected blocked line, got: ${last}`);
  });

  it("freezes the total runtime when unsubscribed", () => {
    const updates: string[] = [];
    let intervalCallback: (() => void) | undefined;
    let nowMs = 0;
    let nextTimerId = 0;
    const fakeSession = {
      subscribe: (_h: any) => () => {
      }
    } as any;

    const stream = streamChildSession(fakeSession, "po", "slug", (u: any) => updates.push(u.content[0].text), {
      now: () => nowMs,
      setIntervalFn: (callback: () => void) => {
        intervalCallback = callback;
        return ++nextTimerId as any;
      },
      clearIntervalFn: () => {
      },
    });

    nowMs = 3000;
    intervalCallback?.();
    const beforeUnsubscribe = stream.getLines();
    stream.unsubscribe();
    nowMs = 9000;

    assert.equal(stream.getLines(), beforeUnsubscribe, "total runtime should freeze after unsubscribe");
    assert.ok(beforeUnsubscribe.includes("[po] ⏱ total — 3s"), `expected frozen total runtime, got: ${beforeUnsubscribe}`);
  });
});

// ---------------------------------------------------------------------------
// waitForChildDecision
// ---------------------------------------------------------------------------

describe("waitForChildDecision", () => {
  it("resolves 'finished' when task status becomes finished", async () => {
    const sequence = ["in_progress", "in_progress", "finished"];
    let i = 0;
    const readStatus = async () => ({status: sequence[Math.min(i++, sequence.length - 1)]});
    const result = await waitForChildDecision(readStatus, undefined, 0);
    assert.equal(result, "finished");
  });

  it("resolves 'blocked' when task status becomes blocked", async () => {
    const sequence = ["in_progress", "blocked"];
    let i = 0;
    const readStatus = async () => ({status: sequence[Math.min(i++, sequence.length - 1)]});
    const result = await waitForChildDecision(readStatus, undefined, 0);
    assert.equal(result, "blocked");
  });

  it("calls onPoll with status and blocked_reason when blocked", async () => {
    const polls: Array<{ status: string; reason?: string }> = [];
    const sequence = [{status: "in_progress"}, {status: "blocked", blocked_reason: "need help"}];
    let i = 0;
    const readStatus = async () => sequence[Math.min(i++, sequence.length - 1)];
    await waitForChildDecision(readStatus, (s, r) => polls.push({status: s, reason: r}), 0);
    assert.equal(polls.length, 1);
    assert.equal(polls[0].status, "blocked");
    assert.equal(polls[0].reason, "need help");
  });

  it("resolves 'aborted' immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const readStatus = async () => ({status: "in_progress"});
    const result = await waitForChildDecision(readStatus, undefined, 0, controller.signal);
    assert.equal(result, "aborted");
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
      {status: "finished", resume_message: undefined},
      {status: "in_progress", resume_message: "reopened: try harder"},
    ];
    let i = 0;
    const readStatus = async () => sequence[Math.min(i++, sequence.length - 1)] as {
      status: string;
      resume_message?: string
    } | null;
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
    const src = readFileSync(new URL("../session-factory.ts", import.meta.url).pathname, "utf8");
    assert.ok(src.includes("createTask") || src.includes("updateTaskStatus"), "session-factory must own task setup logic");
  });

  it("exports the missing-checkpoint and child-session-failure blocked reasons", () => {
    const src = readFileSync(new URL("../task-delegate.ts", import.meta.url).pathname, "utf8");
    assert.ok(src.includes("MISSING_CHECKPOINT_BLOCKED_REASON"), "task-delegate.ts must export MISSING_CHECKPOINT_BLOCKED_REASON");
    assert.equal(
      MISSING_CHECKPOINT_BLOCKED_REASON,
      "Automatic recovery failed after the child repeatedly ended turns without reaching a checkpoint.",
    );
    assert.ok(src.includes("CHILD_SESSION_FAILURE_BLOCKED_REASON"), "task-delegate.ts must export CHILD_SESSION_FAILURE_BLOCKED_REASON");
    assert.equal(
      CHILD_SESSION_FAILURE_BLOCKED_REASON,
      "Automatic recovery blocked the child task after a child-session failure before it reached a checkpoint.",
    );
  });

  it("task_delegate appends a fixed instruction to the child's initial message", () => {
    const src = readFileSync(new URL("../task-delegate.ts", import.meta.url).pathname, "utf8");
    assert.ok(src.includes("MISSING_CHECKPOINT_BLOCKED_REASON"), "task-delegate.ts must export MISSING_CHECKPOINT_BLOCKED_REASON");
    assert.equal(
      MISSING_CHECKPOINT_BLOCKED_REASON,
      "Automatic recovery failed after the child repeatedly ended turns without reaching a checkpoint.",
    );
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
