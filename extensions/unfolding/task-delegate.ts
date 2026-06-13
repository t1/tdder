import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripFrontmatter } from "./unfold-helpers.ts";

export const CHILD_FIXED_INSTRUCTION =
  "When you have completed your work, call `task_finished` with your task slug. " +
  "If you cannot continue and need commissioner action, call `task_block` with your task slug and a reason.";

// ---------------------------------------------------------------------------
// loadAgentSystemPrompt
// ---------------------------------------------------------------------------

export function loadAgentSystemPrompt(agentsDir: string, role: string): string | null {
  const path = join(agentsDir, `unfolding-${role}.md`);
  if (!existsSync(path)) return null;
  return stripFrontmatter(readFileSync(path, "utf8"));
}

// ---------------------------------------------------------------------------
// waitForChildDecision
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 500;

export async function waitForChildDecision(
  readStatus: () => Promise<string | null>,
  pollIntervalMs = POLL_INTERVAL_MS,
): Promise<"finished" | "blocked"> {
  while (true) {
    const status = await readStatus();
    if (status === "finished") return "finished";
    if (status === "blocked") return "blocked";
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
