/**
 * Lets the user connect to any unfolding sub-session in a new tmux window.
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Task } from "./task-store.ts";

export interface ConnectOption {
  label: string;
  slug: string;
  role: string;
  sessionFile: string;
}

/** Build the ordered list of selectable sessions shown in the picker.
 *  Tasks come first (in the order passed), then the root session as the
 *  "stay here" fallback. */
export function buildConnectOptions(
  tasks: Task[],
  commissionerSessionFile: string | undefined,
): ConnectOption[] {
  const options: ConnectOption[] = tasks.map(t => ({
    label: `[${t.to}] ${t.slug} (${t.status})`,
    slug: t.slug,
    role: t.to,
    sessionFile: t.session_file!,
  }));
  if (commissionerSessionFile) {
    options.push({
      label: "Stay here (root session)",
      slug: "",
      role: "",
      sessionFile: commissionerSessionFile,
    });
  }
  return options;
}

export interface LaunchResult {
  launched: boolean;
  /** Command to run manually when not inside tmux */
  fallbackCommand?: string;
}

/** Open a new tmux window running `pi --session <file>` with the role system prompt.
 *  Returns { launched: true } when inside tmux, or a fallback command string
 *  when not. The exec function matches pi.exec()'s signature subset. */
export async function launchInTmux(
  option: ConnectOption,
  exec: (cmd: string, args: string[]) => Promise<{ code: number | null; stderr?: string }>,
  tmuxEnv: string | undefined = process.env.TMUX,
  systemPrompt?: string,
): Promise<LaunchResult> {
  const args = ["--session", option.sessionFile];
  if (systemPrompt) {
    const promptFile = join(tmpdir(), `pi-role-${option.slug || "root"}.md`);
    writeFileSync(promptFile, systemPrompt, "utf8");
    args.push("--system-prompt", promptFile);
  }
  const shellQuote = (s: string) => (s.includes(" ") || s.includes("\n") ? "'" + s.replace(/'/g, "'\\'") + "'" : s);
  const piCmd = "pi " + args.map(shellQuote).join(" ");
  if (!tmuxEnv) {
    return { launched: false, fallbackCommand: piCmd };
  }
  const { code, stderr } = await exec("tmux", ["new-window", "-n", option.slug || "root", piCmd]);
  if (code !== 0) throw new Error(`tmux new-window failed (exit ${code})${stderr ? ": " + stderr : ""}`);
  return { launched: true };
}
