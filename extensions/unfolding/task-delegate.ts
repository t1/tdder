import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession, AgentSessionEvent, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { stripFrontmatter } from "./unfold-helpers.ts";

export const CHILD_FIXED_INSTRUCTION =
  "When you have completed your work, call `task_finished`. " +
  "If you cannot continue and need commissioner action, call `task_block` with a reason.";

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
  switch (toolName) {
    case "write":    return `${toolName} ${args.path ?? ""}`;
    case "edit":     return `${toolName} ${args.path ?? ""}`;
    case "read":     return `${toolName} ${args.path ?? ""}`;
    case "bash":     return `${toolName} ${String(args.command ?? "").slice(0, maxCmd)}`;
    case "task_delegate": return `${toolName} ${args.role ?? ""} / ${args.slug ?? ""}`;
    case "task_block":    return toolName;
    case "task_finished": return toolName;
    default:         return toolName;
  }
}

export function streamChildSession(
  session: AgentSession,
  role: string,
  slug: string,
  onUpdate: AgentToolUpdateCallback<unknown>,
): { unsubscribe: () => void; append: (line: string) => void } {
  const lines: string[] = [`[${role}/${slug}]`];

  const flush = () =>
    onUpdate({ content: [{ type: "text", text: lines.join("\n") }], details: undefined });

  const append = (line: string) => {
    lines.push(line);
    flush();
  };

  const prefixLen = `  [${role}] ⚙ `.length;
  // Maps toolCallId -> index in `lines` where that tool's nested output starts
  const delegateLineStart = new Map<string, number>();

  const handleEvent = (event: AgentSessionEvent) => {
    if (event.type === "tool_execution_start") {
      lines.push(`  [${role}] ⚙ ${toolSummary(event.toolName, event.args ?? {}, prefixLen)}`);
      if (event.toolName === "task_delegate") {
        delegateLineStart.set(event.toolCallId, lines.length);
      }
      flush();
    } else if (event.type === "tool_execution_update" && event.toolName === "task_delegate") {
      const text: string = event.partialResult?.content?.[0]?.text ?? "";
      if (text) {
        const start = delegateLineStart.get(event.toolCallId) ?? lines.length;
        lines.splice(start);
        for (const line of text.split("\n")) lines.push("    " + line);
        flush();
      }
    } else if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      const last = lines[lines.length - 1];
      if (last?.startsWith(`  [${role}] 💬 `)) {
        lines[lines.length - 1] = last + event.assistantMessageEvent.delta;
      } else {
        lines.push(`  [${role}] 💬 ` + event.assistantMessageEvent.delta);
      }
      flush();
    } else if (event.type === "turn_end") {
      lines.push("");
      flush();
    }
  };

  flush();
  const unsubscribe = session.subscribe(handleEvent);
  return { unsubscribe, append, getLines: () => lines.join("\n") };
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
