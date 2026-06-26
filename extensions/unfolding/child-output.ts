import type { AgentSessionEvent, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const ANSI_ITALIC_ON = "\x1b[3m";
export const ANSI_ITALIC_OFF = "\x1b[23m";

export interface LegacyRenderedChildOutputEvent {
  type: "legacy_rendered";
  text: string;
}

export type ChildOutputEvent = LegacyRenderedChildOutputEvent | AgentSessionEvent;

export interface ChildOutputDetails {
  childOutputRole?: string;
  childOutputEvents?: ChildOutputEvent[];
}

export function legacyRendered(text: string): LegacyRenderedChildOutputEvent {
  return { type: "legacy_rendered", text };
}

function renderAssistantLine(role: string, icon: "💬" | "🤔", text: string): string {
  const prefix = `  [${role}] ${icon} `;
  return icon === "🤔"
    ? `${prefix}${ANSI_ITALIC_ON}${text}${ANSI_ITALIC_OFF}`
    : `${prefix}${text}`;
}

export function renderChildOutputPlainText(role: string, events: ChildOutputEvent[]): string {
  const rendered: Array<string | { role: string; icon: "💬" | "🤔"; text: string }> = [];
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
      icon: kind === "thinking" ? "🤔" : "💬",
      text: pending.trimStart(),
    });
  };

  for (const event of events) {
    if (event.type === "legacy_rendered") {
      rendered.push(event.text);
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
  if (!role || !events || events.length === 0) return undefined;
  return {
    render(width: number) {
      return renderChildOutputBox(role, events, theme, Math.max(1, width), "toolSuccessBg");
    },
    invalidate() {
    },
  };
}
