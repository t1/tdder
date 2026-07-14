import type { AgentSessionEvent, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
export { formatElapsedDuration } from "../shared/duration-format.ts";
import { formatElapsedDuration } from "../shared/duration-format.ts";

export const ANSI_ITALIC_ON = "\x1b[3m";
export const ANSI_ITALIC_OFF = "\x1b[23m";
export const ANSI_RED_ON = "\x1b[31m";
export const ANSI_RED_OFF = "\x1b[39m";

export interface HeaderChildOutputEvent {
  type: "header";
  slug: string;
}

export type ToolRowStatus = "pending" | "success" | "error";

export interface ToolChildOutputEvent {
  type: "tool";
  summary: string;
  elapsedSeconds?: number;
  status: ToolRowStatus;
  errorSummary?: string;
  outputTail?: string[];
}

export interface NoteChildOutputEvent {
  type: "note";
  text: string;
}

export interface WidgetChildOutputEvent {
  type: "widget";
  key: string;
  lines?: string[];
}

export interface StatusChildOutputEvent {
  type: "status";
  key: string;
  text?: string;
}

export interface CommissionerNoteChildOutputEvent {
  type: "t1-unfolding-commissioner-note";
  text: string;
}

export interface ContextUsageSnapshot {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface TotalChildOutputEvent {
  type: "total";
  elapsedSeconds: number;
  contextUsage?: ContextUsageSnapshot;
  cost?: number;
  finishedDescendantCost?: number;
}

export type ChildOutputEvent =
  | HeaderChildOutputEvent
  | ToolChildOutputEvent
  | NoteChildOutputEvent
  | WidgetChildOutputEvent
  | StatusChildOutputEvent
  | CommissionerNoteChildOutputEvent
  | TotalChildOutputEvent
  | AgentSessionEvent;

export interface ChildOutputDetails {
  childOutputRole?: string;
  childOutputEvents?: ChildOutputEvent[];
}

export function childOutputHeader(slug: string): HeaderChildOutputEvent {
  return { type: "header", slug };
}

export function childOutputTool(
  summary: string,
  elapsedSeconds: number | undefined,
  status: ToolRowStatus,
  errorSummary?: string,
  outputTail?: string[],
): ToolChildOutputEvent {
  return { type: "tool", summary, elapsedSeconds, status, errorSummary, outputTail };
}

export function childOutputNote(text: string): NoteChildOutputEvent {
  return { type: "note", text };
}

export function childOutputWidget(key: string, lines: string[] | undefined): WidgetChildOutputEvent {
  return { type: "widget", key, lines };
}

export function childOutputStatus(key: string, text: string | undefined): StatusChildOutputEvent {
  return { type: "status", key, text };
}

export function childOutputCommissionerNote(text: string): CommissionerNoteChildOutputEvent {
  return { type: "t1-unfolding-commissioner-note", text };
}

export function childOutputTotal(elapsedSeconds: number, contextUsage?: ContextUsageSnapshot, cost?: number, finishedDescendantCost?: number): TotalChildOutputEvent {
  return { type: "total", elapsedSeconds, contextUsage, cost, finishedDescendantCost };
}

function renderAssistantLine(role: string, icon: "💬" | "⋯", text: string): string {
  const prefix = `  [${role}] ${icon} `;
  return icon === "⋯"
    ? `${prefix}${ANSI_ITALIC_ON}${text}${ANSI_ITALIC_OFF}`
    : `${prefix}${text}`;
}

function renderToolLines(role: string, event: ToolChildOutputEvent): string[] {
  let line = `  [${role}] ⚙ ${event.summary}`;
  if (event.elapsedSeconds !== undefined) line += ` — ${formatElapsedDuration(event.elapsedSeconds)}`;
  if (event.status === "success") line += " ✓";
  if (event.status === "error") line += " ✗";
  if (event.errorSummary) line += ` — ${event.errorSummary}`;
  return [line, ...(event.outputTail ?? []).map(outputLine => `    ${outputLine}`)];
}

export function renderContextUsageSuffix(contextUsage: ContextUsageSnapshot): string {
  const { tokens, contextWindow, percent } = contextUsage;
  const pct = percent !== null ? `${Math.round(percent)}%` : "?%";
  const used = tokens !== null ? `${Math.round(tokens / 1000)}k` : "?k";
  const max = `${Math.round(contextWindow / 1000)}k`;
  const italic = `${ANSI_ITALIC_ON}${used}/${max} (${pct})${ANSI_ITALIC_OFF}`;
  return percent !== null && percent >= 90 ? `${ANSI_RED_ON}${italic}${ANSI_RED_OFF}` : italic;
}

export function renderCostSuffix(cost: number): string {
  return `${ANSI_ITALIC_ON}$${cost.toFixed(2)}${ANSI_ITALIC_OFF}`;
}

export function renderDescendantCostSuffix(finishedDescendantCost: number): string {
  return `${ANSI_ITALIC_ON}(+ $${finishedDescendantCost.toFixed(2)})${ANSI_ITALIC_OFF}`;
}

export function renderTotalLine(role: string, elapsedSeconds: number, contextUsage?: ContextUsageSnapshot, cost?: number, finishedDescendantCost?: number): string {
  const base = `  [${role}] ⏱ ${formatElapsedDuration(elapsedSeconds)}`;
  const withContext = contextUsage ? `${base} ${renderContextUsageSuffix(contextUsage)}` : base;
  const withCost = cost !== undefined ? `${withContext} ${renderCostSuffix(cost)}` : withContext;
  return finishedDescendantCost !== undefined && finishedDescendantCost > 0
    ? `${withCost} ${renderDescendantCostSuffix(finishedDescendantCost)}`
    : withCost;
}

export function renderChildOutputPlainText(role: string, events: ChildOutputEvent[]): string {
  const rendered: Array<string | { role: string; icon: "💬" | "⋯"; text: string }> = [];
  const assistantRowIndexes = new Map<string, number>();
  const pendingWhitespace = new Map<string, string>();

  const appendAssistantDelta = (kind: "text" | "thinking", contentIndex: number | undefined, delta: string) => {
    const key = `${kind}:${contentIndex ?? -1}`;
    const existingIndex = assistantRowIndexes.get(key);
    if (existingIndex !== undefined) {
      const row = rendered[existingIndex];
      if (typeof row === "string") return;
      row.text += delta;
      return;
    }

    const pending = (pendingWhitespace.get(key) ?? "") + delta;
    if (pending.trim().length === 0) {
      pendingWhitespace.set(key, pending);
      return;
    }

    pendingWhitespace.delete(key);
    assistantRowIndexes.set(key, rendered.length);
    rendered.push({
      role,
      icon: kind === "thinking" ? "⋯" : "💬",
      text: pending.trimStart(),
    });
  };

  for (const event of events) {
    if (event.type === "header") {
      rendered.push(`[${role}/${event.slug}]`);
      continue;
    }

    if (event.type === "tool") {
      rendered.push(...renderToolLines(role, event));
      continue;
    }

    if (event.type === "note" || event.type === "t1-unfolding-commissioner-note") {
      rendered.push(event.text);
      continue;
    }

    if (event.type === "widget") {
      if (event.lines && event.lines.length > 0) rendered.push(...event.lines);
      continue;
    }

    if (event.type === "status") {
      if (event.text) rendered.push(`  [${role}] ${event.text}`);
      continue;
    }

    if (event.type === "total") {
      rendered.push(renderTotalLine(role, event.elapsedSeconds, event.contextUsage, event.cost, event.finishedDescendantCost));
      continue;
    }

    if (
      event.type === "message_update" &&
      event.message.role === "assistant" &&
      (event.assistantMessageEvent.type === "thinking_delta" || event.assistantMessageEvent.type === "text_delta")
    ) {
      appendAssistantDelta(
        event.assistantMessageEvent.type === "thinking_delta" ? "thinking" : "text",
        event.assistantMessageEvent.contentIndex,
        event.assistantMessageEvent.delta,
      );
    }
  }

  return rendered
    .map(line => typeof line === "string" ? line : renderAssistantLine(role, line.icon, line.text))
    .join("\n");
}

function wrapPreservingBlankLines(text: string, width: number): string[] {
  return text.split("\n").flatMap(line => {
    if (line.length === 0) return [""];
    const wrapped = wrapTextWithAnsi(line, width);
    return wrapped.length > 0 ? wrapped : [""];
  });
}

function padVisibleWidth(text: string, width: number): string {
  const padding = Math.max(0, width - visibleWidth(text));
  return `${text}${" ".repeat(padding)}`;
}

export function renderChildOutputBox(
  role: string,
  events: ChildOutputEvent[],
  theme: { bg: (color: string, text: string) => string },
  width: number,
  backgroundColor = "customMessageBg",
): string[] {
  const innerWidth = Math.max(1, width - 2);
  const backgroundLine = theme.bg(backgroundColor, " ".repeat(innerWidth + 2));
  const content = wrapPreservingBlankLines(renderChildOutputPlainText(role, events), innerWidth)
    .map(line => theme.bg(backgroundColor, ` ${padVisibleWidth(line, innerWidth)} `));
  return [backgroundLine, ...content, backgroundLine];
}

export function childOutputEventsFromResult(result: AgentToolResult<ChildOutputDetails> | undefined): ChildOutputEvent[] | undefined {
  return result?.details?.childOutputEvents;
}

export function renderChildOutputResult(result: AgentToolResult<ChildOutputDetails>, _options: unknown, theme: { bg: (color: string, text: string) => string }) {
  const role = result.details?.childOutputRole;
  const events = childOutputEventsFromResult(result);
  if (!role || !events || events.length === 0) {
    return {
      render() {
        return [];
      },
      invalidate() {
      },
    };
  }
  return {
    render(width: number) {
      return renderChildOutputBox(role, events, theme, Math.max(1, width), "toolSuccessBg");
    },
    invalidate() {
    },
  };
}
