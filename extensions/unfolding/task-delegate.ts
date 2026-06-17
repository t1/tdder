import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession, AgentSessionEvent, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { readTask, updateTaskStatus } from "./task-store.ts";
import { stripFrontmatter } from "./unfold-helpers.ts";

export const CHILD_FIXED_INSTRUCTION =
  "When you have completed your work, call `task_finished`. " +
  "If you cannot continue and need commissioner action, call `task_block` with a reason.";

export const TRUNCATION_BLOCKED_REASON =
  "Automatic recovery failed after repeated truncation before the child reached a checkpoint.";

const TRUNCATION_RECOVERY_PROMPT =
  "Your last response was truncated before you reached a checkpoint. Continue in smaller concrete steps, or call task_block with a workflow-level reason if you cannot continue.";

// ---------------------------------------------------------------------------
// loadAgentSystemPrompt
// ---------------------------------------------------------------------------

export function loadAgentSystemPrompt(rolesDir: string, role: string): string | null {
  const path = join(rolesDir, `${role}.md`);
  if (!existsSync(path)) return null;
  return stripFrontmatter(readFileSync(path, "utf8"));
}

// ---------------------------------------------------------------------------
// streamChildSession
// ---------------------------------------------------------------------------

function toolSummary(toolName: string, args: Record<string, unknown>, prefixLen: number): string {
  const termWidth = process.stdout.columns ?? 120;
  const maxCmd = Math.max(20, termWidth - prefixLen - toolName.length - 1);
  const withArg = (value: unknown) => {
    const text = String(value ?? "").trim();
    return text ? `${toolName} ${text}` : toolName;
  };
  switch (toolName) {
    case "write": return withArg(args.path);
    case "edit": return withArg(args.path);
    case "read": return withArg(args.path);
    case "bash": return withArg(String(args.command ?? "").slice(0, maxCmd));
    case "task_delegate": return `${toolName} ${args.role ?? ""} / ${args.slug ?? ""}`;
    case "task_block": return toolName;
    case "task_finished": return toolName;
    default: return toolName;
  }
}

function summarizeToolError(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const candidate = result as { content?: Array<{ type?: string; text?: string }> };
  const text = candidate.content?.find(part => part?.type === "text" && typeof part.text === "string")?.text?.trim();
  if (!text) return "";
  return text.split("\n")[0]?.trim() ?? "";
}

function summarizeAssistantError(event: AgentSessionEvent): string {
  if (event.type !== "message_update" || event.assistantMessageEvent.type !== "error") return "";
  return event.assistantMessageEvent.errorMessage?.trim() || "assistant stream error";
}

const INTENTIONALLY_SKIPPED_EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "turn_start",
  "message_start",
]);

const INTENTIONALLY_SKIPPED_ASSISTANT_MESSAGE_EVENT_TYPES = new Set([
  "start",
  "text_start",
  "text_end",
  "thinking_start",
  "thinking_end",
  "toolcall_start",
  "toolcall_delta",
  "toolcall_end",
  "done",
]);

type ToolRowStatus = "pending" | "success" | "error";

type StreamRow =
  | { kind: "tool"; toolCallId: string; summary: string; startedAt: number; status: ToolRowStatus; errorSummary?: string; nestedText?: string }
  | { kind: "assistant"; rowKey: string; icon: "💬" | "🤔"; text: string }
  | { kind: "note"; text: string };

export interface StreamChildSessionOptions {
  now?: () => number;
  setIntervalFn?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (interval: ReturnType<typeof setInterval>) => void;
  tickMs?: number;
}

/**
 * Child-session display policy:
 * - show all tool rows in place with elapsed time and terminal marker
 * - show nested tool_execution_update only for task_delegate
 * - show assistant message_update deltas for text and thinking, plus assistant stream errors
 * - show an explicit warning when a thinking-bearing assistant message is truncated by length limit
 * - intentionally skip protocol noise / lifecycle chatter listed above
 * - warn on anything else so new upstream event types don't fail silently
 */
function logUnexpectedChildEvent(role: string, slug: string, event: AgentSessionEvent) {
  console.warn(`[unfolding] unexpected child event for ${role}/${slug}: ${JSON.stringify(event)}`);
}

function hasThinkingContent(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const candidate = message as { content?: Array<{ type?: string }> };
  return candidate.content?.some(part => part?.type === "thinking") ?? false;
}

function isThinkingLengthTruncation(event: AgentSessionEvent): boolean {
  if (event.type !== "message_end") return false;
  if (event.message.role !== "assistant") return false;
  return event.message.stopReason === "length" && hasThinkingContent(event.message);
}

export function streamChildSession(
  session: AgentSession,
  role: string,
  slug: string,
  onUpdate: AgentToolUpdateCallback<unknown>,
  options: StreamChildSessionOptions = {},
): { unsubscribe: () => void; append: (line: string) => void; getLines: () => string } {
  const prefixLen = `  [${role}] ⚙ `.length;
  const rows: StreamRow[] = [];
  const toolRows = new Map<string, Extract<StreamRow, { kind: "tool" }>>();
  const assistantRows = new Map<string, Extract<StreamRow, { kind: "assistant" }>>();
  const pendingBlockWhitespace = new Map<string, string>();
  const now = options.now ?? (() => Date.now());
  const setIntervalFn = options.setIntervalFn ?? ((callback, ms) => setInterval(callback, ms));
  const clearIntervalFn = options.clearIntervalFn ?? ((interval) => clearInterval(interval));
  const tickMs = options.tickMs ?? 1000;
  let timer: ReturnType<typeof setInterval> | undefined;

  const renderToolRow = (row: Extract<StreamRow, { kind: "tool" }>): string[] => {
    const elapsedSeconds = Math.max(0, Math.floor((now() - row.startedAt) / 1000));
    let line = `  [${role}] ⚙ ${row.summary} — ${elapsedSeconds}s`;
    if (row.status === "success") line += " ✓";
    if (row.status === "error") line += " ✗";
    if (row.errorSummary) line += ` — ${row.errorSummary}`;

    const rendered = [line];
    if (row.nestedText) {
      for (const nestedLine of row.nestedText.split("\n")) rendered.push(`    ${nestedLine}`);
    }
    return rendered;
  };

  const getLines = () => [
    `[${role}/${slug}]`,
    ...rows.flatMap(row => {
      switch (row.kind) {
        case "tool": return renderToolRow(row);
        case "assistant": return [`  [${role}] ${row.icon} ${row.text}`];
        case "note": return [row.text];
      }
    }),
  ].join("\n");

  const flush = () =>
    onUpdate({ content: [{ type: "text", text: getLines() }], details: undefined });

  const syncTimer = () => {
    const needsTimer = rows.some(row => row.kind === "tool" && row.status === "pending");
    if (needsTimer && !timer) {
      timer = setIntervalFn(() => flush(), tickMs);
      (timer as { unref?: () => void }).unref?.();
    } else if (!needsTimer && timer) {
      clearIntervalFn(timer);
      timer = undefined;
    }
  };

  const append = (line: string) => {
    rows.push({ kind: "note", text: line });
    flush();
  };

  const appendAssistantDelta = (kind: "text" | "thinking", contentIndex: number | undefined, delta: string) => {
    const key = `${kind}:${contentIndex ?? -1}`;
    const existingRow = assistantRows.get(key);
    if (existingRow) {
      existingRow.text += delta;
      flush();
      return;
    }

    const pending = (pendingBlockWhitespace.get(key) ?? "") + delta;
    if (pending.trim().length === 0) {
      pendingBlockWhitespace.set(key, pending);
      return;
    }

    const row: Extract<StreamRow, { kind: "assistant" }> = {
      kind: "assistant",
      rowKey: key,
      icon: kind === "text" ? "💬" : "🤔",
      text: pending.trimStart(),
    };
    assistantRows.set(key, row);
    pendingBlockWhitespace.delete(key);
    rows.push(row);
    flush();
  };

  const resetAssistantBlocks = () => {
    assistantRows.clear();
    pendingBlockWhitespace.clear();
  };

  const handleEvent = (event: AgentSessionEvent) => {
    if (event.type === "tool_execution_start") {
      const row: Extract<StreamRow, { kind: "tool" }> = {
        kind: "tool",
        toolCallId: event.toolCallId,
        summary: toolSummary(event.toolName, event.args ?? {}, prefixLen),
        startedAt: now(),
        status: "pending",
      };
      toolRows.set(event.toolCallId, row);
      rows.push(row);
      syncTimer();
      flush();
      return;
    }

    if (event.type === "tool_execution_update" && event.toolName === "task_delegate") {
      const row = toolRows.get(event.toolCallId);
      if (!row) {
        logUnexpectedChildEvent(role, slug, event);
        return;
      }
      const text: string = event.partialResult?.content?.[0]?.text ?? "";
      if (!text) return;
      row.nestedText = text;
      flush();
      return;
    }

    if (event.type === "tool_execution_end") {
      const row = toolRows.get(event.toolCallId);
      if (!row) {
        logUnexpectedChildEvent(role, slug, event);
        return;
      }
      row.status = event.isError ? "error" : "success";
      row.errorSummary = event.isError ? summarizeToolError(event.result) : undefined;
      syncTimer();
      flush();
      return;
    }

    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      appendAssistantDelta("text", event.assistantMessageEvent.contentIndex, event.assistantMessageEvent.delta);
      return;
    }

    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "thinking_delta"
    ) {
      appendAssistantDelta("thinking", event.assistantMessageEvent.contentIndex, event.assistantMessageEvent.delta);
      return;
    }

    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "error"
    ) {
      rows.push({ kind: "note", text: `  [${role}] ❌ ${summarizeAssistantError(event)}` });
      flush();
      return;
    }

    if (event.type === "turn_end") {
      resetAssistantBlocks();
      return;
    }

    if (isThinkingLengthTruncation(event)) {
      rows.push({ kind: "note", text: `  [${role}] ⚠ thinking truncated by length limit` });
      flush();
      return;
    }

    if (event.type === "message_update") {
      if (INTENTIONALLY_SKIPPED_ASSISTANT_MESSAGE_EVENT_TYPES.has(event.assistantMessageEvent.type)) return;
      logUnexpectedChildEvent(role, slug, event);
      return;
    }

    if (INTENTIONALLY_SKIPPED_EVENT_TYPES.has(event.type) || event.type === "message_end") {
      return;
    }

    logUnexpectedChildEvent(role, slug, event);
  };

  flush();
  const unsubscribeSession = session.subscribe(handleEvent);
  return {
    append,
    getLines,
    unsubscribe: () => {
      if (timer) {
        clearIntervalFn(timer);
        timer = undefined;
      }
      unsubscribeSession();
    },
  };
}

export function installTruncationRecovery(session: AgentSession, cwd: string, slug: string): () => void {
  let recoveryAttempted = false;
  let sawLengthTruncationThisTurn = false;
  return session.subscribe((event) => {
    if (event.type === "message_end") {
      if (event.message.role === "assistant" && event.message.stopReason === "length") {
        sawLengthTruncationThisTurn = true;
      }
      return;
    }

    if (event.type !== "turn_end") return;
    if (!sawLengthTruncationThisTurn) return;
    sawLengthTruncationThisTurn = false;

    const task = readTask(cwd, slug);
    if (task?.status !== "in_progress") return;

    if (!recoveryAttempted) {
      recoveryAttempted = true;
      session.prompt(TRUNCATION_RECOVERY_PROMPT, { streamingBehavior: "followUp" }).catch((err: unknown) => {
        const stack = err instanceof Error ? err.stack : String(err);
        console.error(`[unfolding] truncation recovery prompt for task "${slug}" failed:`, stack);
      });
      return;
    }

    updateTaskStatus(cwd, slug, "blocked", TRUNCATION_BLOCKED_REASON);
  });
}

const POLL_INTERVAL_MS = 500;

export async function waitForChildDecision(
  readStatus: () => Promise<{ status: string; blocked_reason?: string } | null>,
  onPoll?: (status: string, blocked_reason?: string) => void,
  pollIntervalMs = POLL_INTERVAL_MS,
  signal?: AbortSignal,
): Promise<"finished" | "blocked" | "aborted"> {
  while (true) {
    if (signal?.aborted) return "aborted";
    const task = await readStatus();
    const status = task?.status ?? null;
    if (status === "finished") return "finished";
    if (status === "blocked") {
      onPoll?.(status, task?.blocked_reason);
      return "blocked";
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
}

// ---------------------------------------------------------------------------
// waitForResume
// ---------------------------------------------------------------------------

export const ACCEPTED_MESSAGE = "accepted. you can close your session now";

export async function waitForResume(
  readStatus: () => Promise<{ status: string; resume_message?: string } | null>,
  pollIntervalMs = POLL_INTERVAL_MS,
): Promise<{ outcome: "accepted" | "in_progress"; message: string }> {
  while (true) {
    const task = await readStatus();
    if (task === null) return { outcome: "accepted", message: ACCEPTED_MESSAGE };
    if (task.status === "in_progress") {
      return { outcome: "in_progress", message: task.resume_message ?? "in_progress" };
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
}
