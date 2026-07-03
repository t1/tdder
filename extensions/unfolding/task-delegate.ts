import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession, AgentSessionEvent, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import {
  childOutputHeader,
  childOutputNote,
  childOutputTool,
  childOutputTotal,
  formatElapsedDuration,
  type ChildOutputDetails,
  type ChildOutputEvent,
  ANSI_ITALIC_OFF,
  ANSI_ITALIC_ON,
} from "./child-output.ts";
import { readTask, updateTaskStatus } from "./task-store.ts";
import { stripFrontmatter } from "./unfold-helpers.ts";

export const CHILD_FIXED_INSTRUCTION =
  "Call `task_finished` only when your responsibility for this task is fully complete. " +
  "Do not call it merely because you wrote files or described status; if the task still requires delegation, verification, or another concrete next action, do that first. " +
  "If you cannot continue and need commissioner action, call `task_block` with a reason.";

export const TRUNCATION_BLOCKED_REASON =
  "Automatic recovery failed after repeated truncation before the child reached a checkpoint.";

export const MISSING_CHECKPOINT_BLOCKED_REASON =
  "Automatic recovery failed after the child repeatedly ended turns without reaching a checkpoint.";

export const CHILD_SESSION_FAILURE_BLOCKED_REASON =
  "Automatic recovery blocked the child task after a child-session failure before it reached a checkpoint.";

export class FatalChildSessionError extends Error {
  readonly slug: string;
  readonly detail: string;

  constructor(slug: string, detail: string) {
    super(`fatal child session error in \"${slug}\": ${detail}`);
    this.name = "FatalChildSessionError";
    this.slug = slug;
    this.detail = detail;
  }
}

const TRUNCATION_RECOVERY_PROMPT =
  "Your last response was truncated before you reached a checkpoint. Continue in smaller concrete steps, or call task_block with a workflow-level reason if you cannot continue.";

const MISSING_CHECKPOINT_RECOVERY_PROMPT =
  "Your last turn ended without reaching a checkpoint. Do not just describe status. Call `task_finished` only if your responsibility for this task is fully complete. Do not call it merely because you wrote files; if the task still requires delegation, verification, or another concrete next action, do that first. If you cannot continue and need commissioner action, call `task_block` with a reason.";

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

function summarizeRetryError(errorMessage: string | undefined): string {
  return errorMessage?.trim() || "retryable model error";
}

const INTENTIONALLY_SKIPPED_EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "turn_start",
  "message_start",
  "queue_update",
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

type StreamRow =
  | { kind: "tool"; toolCallId: string; summary: string; startedAt: number; finishedAt?: number; status: ToolRowStatus; errorSummary?: string; outputTail?: string[] }
  | { kind: "assistant"; rowKey: string; icon: "💬" | "🤔"; text: string }
  | { kind: "note"; text: string };

function renderAssistantRow(role: string, row: Extract<StreamRow, { kind: "assistant" }>): string {
  const prefix = `  [${role}] ${row.icon} `;
  return row.icon === "🤔"
    ? `${prefix}${ANSI_ITALIC_ON}${row.text}${ANSI_ITALIC_OFF}`
    : `${prefix}${row.text}`;
}

export interface StreamChildSessionOptions {
  now?: () => number;
  setIntervalFn?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (interval: ReturnType<typeof setInterval>) => void;
  tickMs?: number;
  sessionFile?: string;
}

/**
 * Child-session display policy:
 * - show all tool rows in place with elapsed time and terminal marker
 * - forward tool_execution_update fully (all lines) for delegation tools (task_delegate, task_unblock, task_reopen, task_rollback, task_accept)
 * - truncate tool_execution_update to the last 5 lines for all other tools
 * - show assistant message_update deltas for text and thinking, plus assistant stream errors
 * - show an explicit warning when a thinking-bearing assistant message is truncated by length limit
 * - intentionally skip protocol noise / lifecycle chatter listed above
 * - show reduced unexpected-event notices in the normal transcript with a session log reference
 */
function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateSummary(text: string, max = 140): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function sessionLogSuffix(sessionFile?: string): string {
  return sessionFile ? ` — see ${sessionFile}` : "";
}

const MAX_TOOL_OUTPUT_LINES = 5;

function extractToolUpdateText(partialResult: unknown): string {
  if (!partialResult || typeof partialResult !== "object") return "";
  const candidate = partialResult as { content?: Array<{ type?: string; text?: string }> };
  return candidate.content
    ?.filter(part => part?.type === "text" && typeof part.text === "string")
    .map(part => part.text ?? "")
    .join("\n")
    .trimEnd() ?? "";
}

const DELEGATION_TOOLS = new Set([
  "task_delegate",
  "task_unblock",
  "task_reopen",
  "task_rollback",
  "task_accept",
]);

function tailLines(text: string, maxLines = MAX_TOOL_OUTPUT_LINES): string[] {
  if (!text) return [];
  return text.split("\n").slice(-maxLines);
}

function allLines(text: string): string[] {
  if (!text) return [];
  return text.split("\n");
}

function summarizeUnexpectedChildEvent(role: string, slug: string, sessionFile: string | undefined, event: AgentSessionEvent): string {
  const base = `  [${role}] ⚠ unexpected child event for ${role}/${slug}`;
  if (event.type === "tool_execution_update") {
    const parts = [`tool=${event.toolName}`];
    const childSlug = typeof event.args?.slug === "string" && event.args.slug.trim()
      ? event.args.slug.trim()
      : slug;
    parts.push(`slug=${childSlug}`);
    const reason = typeof event.args?.reason === "string" ? truncateSummary(compactWhitespace(event.args.reason)) : "";
    if (reason) parts.push(`reason=${reason}`);
    return `${base}: ${parts.join(" — ")}${sessionLogSuffix(sessionFile)}`;
  }

  if (event.type === "message_update") {
    return `${base}: type=${event.type}/${event.assistantMessageEvent.type}${sessionLogSuffix(sessionFile)}`;
  }

  return `${base}: type=${event.type}${sessionLogSuffix(sessionFile)}`;
}

function hasThinkingContent(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const candidate = message as { content?: Array<{ type?: string }> };
  return candidate.content?.some(part => part?.type === "thinking") ?? false;
}

function summarizeTerminalAssistantFailure(message: unknown): string {
  if (!message || typeof message !== "object") return "child session failure";
  const candidate = message as { errorMessage?: string; stopReason?: string };
  const text = candidate.errorMessage?.trim();
  if (text) return text;
  if (candidate.stopReason === "aborted") return "request was aborted";
  return "child session failure";
}

function isThinkingLengthTruncation(event: AgentSessionEvent): boolean {
  if (event.type !== "message_end") return false;
  if (event.message.role !== "assistant") return false;
  return event.message.stopReason === "length" && hasThinkingContent(event.message);
}

function isTerminalAssistantFailure(event: AgentSessionEvent): boolean {
  if (event.type !== "message_end") return false;
  if (event.message.role !== "assistant") return false;
  return event.message.stopReason === "error" || event.message.stopReason === "aborted";
}

export function childSessionFailureBlockedReason(detail: string): string {
  const summary = truncateSummary(compactWhitespace(detail), 180);
  return summary ? `${CHILD_SESSION_FAILURE_BLOCKED_REASON} Last failure: ${summary}` : CHILD_SESSION_FAILURE_BLOCKED_REASON;
}

export function streamChildSession(
  session: AgentSession,
  role: string,
  slug: string,
  onUpdate: AgentToolUpdateCallback<ChildOutputDetails>,
  options: StreamChildSessionOptions = {},
): { unsubscribe: () => void; append: (line: string) => void; getLines: () => string; getOutputEvents: () => ChildOutputEvent[] } {
  const prefixLen = `  [${role}] ⚙ `.length;
  const rows: StreamRow[] = [];
  const toolRows = new Map<string, Extract<StreamRow, { kind: "tool" }>>();
  const assistantRows = new Map<string, Extract<StreamRow, { kind: "assistant" }>>();
  const pendingBlockWhitespace = new Map<string, string>();
  const now = options.now ?? (() => Date.now());
  const setIntervalFn = options.setIntervalFn ?? ((callback, ms) => setInterval(callback, ms));
  const clearIntervalFn = options.clearIntervalFn ?? ((interval) => clearInterval(interval));
  const tickMs = options.tickMs ?? 1000;
  const sessionFile = options.sessionFile;
  const startedAt = now();
  let endedAt: number | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const renderToolRow = (row: Extract<StreamRow, { kind: "tool" }>): string[] => {
    const endedAt = row.finishedAt ?? now();
    const elapsedSeconds = Math.max(0, Math.floor((endedAt - row.startedAt) / 1000));
    let line = `  [${role}] ⚙ ${row.summary} — ${formatElapsedDuration(elapsedSeconds)}`;
    if (row.status === "success") line += " ✓";
    if (row.status === "error") line += " ✗";
    if (row.errorSummary) line += ` — ${row.errorSummary}`;

    const rendered = [line];
    if (row.outputTail?.length) {
      for (const outputLine of row.outputTail) rendered.push(`    ${outputLine}`);
    }
    return rendered;
  };

  const renderTotalLine = () => {
    const totalSeconds = Math.max(0, Math.floor(((endedAt ?? now()) - startedAt) / 1000));
    return `  [${role}] ⏱ total — ${formatElapsedDuration(totalSeconds)}`;
  };

  const getOutputEvents = (): ChildOutputEvent[] => [
    childOutputHeader(slug),
    ...rows.flatMap((row, index) => {
      switch (row.kind) {
        case "tool": {
          const endedAt = row.finishedAt ?? now();
          const elapsedSeconds = Math.max(0, Math.floor((endedAt - row.startedAt) / 1000));
          return [childOutputTool(row.summary, elapsedSeconds, row.status, row.errorSummary, row.outputTail)];
        }
        case "assistant":
          return [{
            type: "message_update",
            message: { role: "assistant" },
            assistantMessageEvent: {
              type: row.icon === "🤔" ? "thinking_delta" : "text_delta",
              contentIndex: index,
              delta: row.text,
            },
          } as AgentSessionEvent];
        case "note": return [childOutputNote(row.text)];
      }
    }),
    childOutputTotal(Math.max(0, Math.floor(((endedAt ?? now()) - startedAt) / 1000))),
  ];

  const getLines = () => [
    `[${role}/${slug}]`,
    ...rows.flatMap(row => {
      switch (row.kind) {
        case "tool": return renderToolRow(row);
        case "assistant": return [renderAssistantRow(role, row)];
        case "note": return [row.text];
      }
    }),
    renderTotalLine(),
  ].join("\n");

  const flush = () =>
    onUpdate({
      content: [{ type: "text", text: getLines() }],
      details: { childOutputRole: role, childOutputEvents: getOutputEvents() },
    });

  const ensureTimer = () => {
    if (timer) return;
    timer = setIntervalFn(() => flush(), tickMs);
    (timer as { unref?: () => void }).unref?.();
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

  const latestCheckpointToolCallId = (): string | undefined => {
    const checkpointToolIds = [...toolRows.values()]
      .filter(row => row.status === "success" && (row.summary === "task_finished" || row.summary === "task_block"))
      .map(row => row.toolCallId);
    return checkpointToolIds.at(-1);
  };

  const isCheckpointAbortTail = (event: AgentSessionEvent): boolean => {
    if (event.type !== "message_end") return false;
    if (event.message.role !== "assistant") return false;
    if (event.message.stopReason !== "aborted") return false;
    return !!latestCheckpointToolCallId();
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
      flush();
      return;
    }

    if (event.type === "tool_execution_update") {
      const row = toolRows.get(event.toolCallId);
      if (!row) {
        rows.push({ kind: "note", text: summarizeUnexpectedChildEvent(role, slug, sessionFile, event) });
        flush();
        return;
      }
      const text = extractToolUpdateText(event.partialResult);
      if (!text) return;
      row.outputTail = DELEGATION_TOOLS.has(event.toolName) ? allLines(text) : tailLines(text);
      flush();
      return;
    }

    if (event.type === "tool_execution_end") {
      const row = toolRows.get(event.toolCallId);
      if (!row) {
        rows.push({ kind: "note", text: summarizeUnexpectedChildEvent(role, slug, sessionFile, event) });
        flush();
        return;
      }
      row.status = event.isError ? "error" : "success";
      row.finishedAt = now();
      row.errorSummary = event.isError ? summarizeToolError(event.result) : undefined;
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

    if (event.type === "auto_retry_start") {
      const seconds = Math.max(1, Math.ceil(event.delayMs / 1000));
      rows.push({
        kind: "note",
        text: `  [${role}] ↻ auto-retry ${event.attempt}/${event.maxAttempts} in ${formatElapsedDuration(seconds)} — ${truncateSummary(summarizeRetryError(event.errorMessage))}`,
      });
      flush();
      return;
    }

    if (event.type === "auto_retry_end") {
      if (!event.success) {
        const detail = truncateSummary(summarizeRetryError(event.finalError));
        rows.push({ kind: "note", text: `  [${role}] ❌ auto-retry failed after attempt ${event.attempt} — ${detail}` });
        flush();
      }
      return;
    }

    if (isThinkingLengthTruncation(event)) {
      rows.push({ kind: "note", text: `  [${role}] ⚠ thinking truncated by length limit` });
      flush();
      return;
    }

    if (isTerminalAssistantFailure(event)) {
      if (isCheckpointAbortTail(event)) return;
      rows.push({ kind: "note", text: `  [${role}] ❌ ${summarizeTerminalAssistantFailure(event.message)}` });
      flush();
      return;
    }

    if (event.type === "message_update") {
      if (INTENTIONALLY_SKIPPED_ASSISTANT_MESSAGE_EVENT_TYPES.has(event.assistantMessageEvent.type)) return;
      rows.push({ kind: "note", text: summarizeUnexpectedChildEvent(role, slug, sessionFile, event) });
      flush();
      return;
    }

    if (INTENTIONALLY_SKIPPED_EVENT_TYPES.has(event.type) || event.type === "message_end") {
      return;
    }

    rows.push({ kind: "note", text: summarizeUnexpectedChildEvent(role, slug, sessionFile, event) });
    flush();
  };

  ensureTimer();
  flush();
  const unsubscribeSession = session.subscribe(handleEvent);
  return {
    append,
    getLines,
    getOutputEvents,
    unsubscribe: () => {
      endedAt = endedAt ?? now();
      if (timer) {
        clearIntervalFn(timer);
        timer = undefined;
      }
      unsubscribeSession();
    },
  };
}

export interface CheckpointRecoveryOptions {
  onRecoveryNote?: (line: string) => void;
}

export interface CheckpointRecoveryHandle {
  unsubscribe: () => void;
  getFatalError: () => FatalChildSessionError | undefined;
}

export function installCheckpointRecovery(
  session: AgentSession,
  cwd: string,
  slug: string,
  options: CheckpointRecoveryOptions = {},
): CheckpointRecoveryHandle {
  let truncationRecoveryAttempted = false;
  let missingCheckpointRecoveryAttempted = false;
  let sawLengthTruncationThisTurn = false;
  let terminalFailureThisTurn: string | undefined;
  let assistantStopReasonThisTurn: string | undefined;
  let fatalError: FatalChildSessionError | undefined;
  const onRecoveryNote = options.onRecoveryNote;

  const clearTurnState = () => {
    sawLengthTruncationThisTurn = false;
    terminalFailureThisTurn = undefined;
    assistantStopReasonThisTurn = undefined;
  };

  const failChildSession = (detail: string) => {
    if (fatalError) return;
    clearTurnState();
    onRecoveryNote?.(`  ⚠ child session failed before a checkpoint — ${truncateSummary(compactWhitespace(detail))}`);
    fatalError = new FatalChildSessionError(slug, detail);
  };

  if (typeof (session as any).subscribe !== "function") {
    return {
      unsubscribe: () => {
      },
      getFatalError: () => fatalError,
    };
  }

  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_end") {
      if (event.message.role !== "assistant") return;
      assistantStopReasonThisTurn = event.message.stopReason;
      if (event.message.stopReason === "length") {
        sawLengthTruncationThisTurn = true;
      }
      if (isTerminalAssistantFailure(event)) {
        terminalFailureThisTurn = summarizeTerminalAssistantFailure(event.message);
      }
      return;
    }

    if (event.type === "agent_end") {
      const task = readTask(cwd, slug);
      if (task?.status !== "in_progress") {
        clearTurnState();
        return;
      }
      if (!terminalFailureThisTurn) return;
      if (event.willRetry) return;
      failChildSession(terminalFailureThisTurn);
      return;
    }

    if (event.type === "auto_retry_end") {
      if (event.success) {
        terminalFailureThisTurn = undefined;
      } else if (terminalFailureThisTurn) {
        failChildSession(terminalFailureThisTurn || event.finalError?.trim() || "child session failure");
      }
      return;
    }

    if (event.type !== "turn_end") return;

    const task = readTask(cwd, slug);
    if (task?.status !== "in_progress") {
      clearTurnState();
      return;
    }

    if (sawLengthTruncationThisTurn) {
      clearTurnState();
      if (!truncationRecoveryAttempted) {
        truncationRecoveryAttempted = true;
        onRecoveryNote?.("  ⚠ child response was truncated before a checkpoint; prompting it to continue or block");
        session.prompt(TRUNCATION_RECOVERY_PROMPT, { streamingBehavior: "followUp" }).catch((err: unknown) => {
          const stack = err instanceof Error ? err.stack : String(err);
          console.error(`[unfolding] truncation recovery prompt for task "${slug}" failed:`, stack);
        });
        return;
      }

      onRecoveryNote?.("  ⚠ automatic recovery failed after repeated truncation; blocking the child task");
      updateTaskStatus(cwd, slug, "blocked", TRUNCATION_BLOCKED_REASON);
      return;
    }

    if (assistantStopReasonThisTurn === "error" || assistantStopReasonThisTurn === "aborted") {
      return;
    }

    if (assistantStopReasonThisTurn === "toolUse") {
      assistantStopReasonThisTurn = undefined;
      return;
    }

    assistantStopReasonThisTurn = undefined;

    if (!missingCheckpointRecoveryAttempted) {
      missingCheckpointRecoveryAttempted = true;
      onRecoveryNote?.("  ⚠ child ended a turn without a checkpoint; prompting it to call task_finished or task_block");
      session.prompt(MISSING_CHECKPOINT_RECOVERY_PROMPT, { streamingBehavior: "followUp" }).catch((err: unknown) => {
        const stack = err instanceof Error ? err.stack : String(err);
        console.error(`[unfolding] missing-checkpoint recovery prompt for task "${slug}" failed:`, stack);
      });
      return;
    }

    onRecoveryNote?.("  ⚠ automatic recovery failed after repeated missing checkpoints; blocking the child task");
    updateTaskStatus(cwd, slug, "blocked", MISSING_CHECKPOINT_BLOCKED_REASON);
  });

  return {
    unsubscribe,
    getFatalError: () => fatalError,
  };
}

const POLL_INTERVAL_MS = 500;

export async function waitForChildDecision(
  readStatus: () => Promise<{ status: string; blocked_reason?: string } | null>,
  onPoll?: (status: string, blocked_reason?: string) => void,
  pollIntervalMs = POLL_INTERVAL_MS,
  signal?: AbortSignal,
  getFatalError?: () => FatalChildSessionError | undefined,
  isChildAborted?: () => boolean | Promise<boolean>,
): Promise<"finished" | "blocked" | "aborted"> {
  while (true) {
    if (signal?.aborted) return "aborted";
    if (await isChildAborted?.()) return "aborted";
    const fatalError = getFatalError?.();
    if (fatalError) throw fatalError;
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
