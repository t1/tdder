/**
 * Hygiene Extension for pi
 *
 * Injects skill-load reminders into the system prompt before each agent turn,
 * for skills that can be detected from the project structure rather than from
 * user intent. The agent sees unconditional instructions — no conditions to
 * evaluate, no filesystem checks required on its side.
 *
 * Detected skills:
 *   project-hygiene — always (this package being loaded is the signal)
 *   java            — any .java or .kt file exists under cwd
 *   github-safety   — .git/config references github.com
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { filterDisplayOnlyMessages } from "../shared/context-filter.ts";
import { getToolPolicy } from "../shared/tool-policy.ts";

function hasJavaOrKotlin(dir: string): boolean {
  // Walk up to two levels deep to keep startup fast on large projects.
  // Most Java/Kotlin projects have source files within src/main/java etc.
  try {
    const matches = globSync("**/*.{java,kt}", {
      cwd: dir,
      maxDepth: 8,
      nodir: true,
    });
    return matches.length > 0;
  } catch {
    return false;
  }
}

function isGitHubProject(dir: string): boolean {
  const configPath = join(dir, ".git", "config");
  if (!existsSync(configPath)) return false;
  try {
    return readFileSync(configPath, "utf8").includes("github.com");
  } catch {
    return false;
  }
}

const INJECTED_PROMPTS_MSG_TYPE = "hygiene-injected-prompts";
const REQUIRES_SESSION_RECREATION_MSG_TYPE = "hygiene-requires-session-recreation";

interface SessionRecreationGuardState {
  requiresSessionRecreation: boolean;
  triggeringToolName?: string;
}

function buildInjectedPromptsMessage(reminders: string[]) {
  return {
    customType: INJECTED_PROMPTS_MSG_TYPE,
    content: [
      "Injected prompts:",
      ...reminders.map((reminder) => `- ${reminder}`),
    ].join("\n"),
    display: true,
    details: { reminders },
  };
}

function buildRequiresSessionRecreationMessage(toolName: string) {
  return {
    customType: REQUIRES_SESSION_RECREATION_MSG_TYPE,
    content: `Session recreation required after ${toolName}; blocking further tool calls except approved session-ending tools.`,
    display: true,
    details: { toolName },
  };
}

export default function (pi: ExtensionAPI) {
  const guardStateBySession = new Map<string, SessionRecreationGuardState>();

  const getSessionKey = (ctx: { sessionManager?: { getSessionFile?: () => string | undefined } }) =>
    ctx.sessionManager?.getSessionFile?.() ?? "__default__";

  const getGuardState = (ctx: { sessionManager?: { getSessionFile?: () => string | undefined } }) => {
    const key = getSessionKey(ctx);
    const existing = guardStateBySession.get(key);
    if (existing) return existing;
    const created: SessionRecreationGuardState = { requiresSessionRecreation: false };
    guardStateBySession.set(key, created);
    return created;
  };

  pi.on("context", async (event) =>
    filterDisplayOnlyMessages(event, INJECTED_PROMPTS_MSG_TYPE, REQUIRES_SESSION_RECREATION_MSG_TYPE) as { messages?: any[] } | undefined,
  );

  pi.registerMessageRenderer<{ reminders?: string[] }>(INJECTED_PROMPTS_MSG_TYPE, (message, _options, theme) => {
    const reminders = message.details?.reminders ?? [];
    const text = [
      theme.fg("muted", "Injected prompts:"),
      ...reminders.map((reminder) => theme.fg("muted", `- ${reminder}`)),
    ].join("\n");
    return new Text(text, 0, 0);
  });

  pi.registerMessageRenderer<{ toolName?: string }>(REQUIRES_SESSION_RECREATION_MSG_TYPE, (message, _options, theme) => {
    const toolName = message.details?.toolName ?? "a tool";
    return new Text(theme.fg("warning", `Session recreation required after ${toolName}; blocking further tool calls except approved session-ending tools.`), 0, 0);
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError || event.details?.requiresSessionRecreation !== true) return;
    const state = getGuardState(ctx);
    state.requiresSessionRecreation = true;
    state.triggeringToolName = event.toolName;
    pi.sendMessage(buildRequiresSessionRecreationMessage(event.toolName));
  });

  pi.on("tool_call", async (event, ctx) => {
    const state = getGuardState(ctx);
    if (!state.requiresSessionRecreation) return;
    const policy = getToolPolicy(pi, event.toolName);
    if (policy?.allowsAfterRequiresSessionRecreation) return;
    return {
      block: true,
      reason: `Tool calls are blocked because ${state.triggeringToolName ?? "a previous tool"} requires session recreation. End the session with an approved tool such as task_block or task_finished.`,
    };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const cwd = event.systemPromptOptions.cwd ?? "";
    const loaded = new Set(event.systemPromptOptions.skills?.map((s) => s.name) ?? []);

    const reminders: string[] = [];

    const state = getGuardState(ctx);
    if (state.requiresSessionRecreation) {
      reminders.push(`A previous tool result requires session recreation after ${state.triggeringToolName ?? "the triggering tool"}. Do not call more tools except approved session-ending tools such as task_block or task_finished.`);
    }

    if (!loaded.has("project-hygiene")) {
      reminders.push("Load the `project-hygiene` skill before proceeding.");
    }

    if (!loaded.has("java") && hasJavaOrKotlin(cwd)) {
      reminders.push("Java or Kotlin source files were detected. Load the `java` skill before proceeding.");
    }

    if (!loaded.has("github-safety") && isGitHubProject(cwd)) {
      reminders.push("This project is hosted on GitHub. Load the `github-safety` skill before proceeding.");
    }

    if (reminders.length === 0) return;

    return {
      systemPrompt: event.systemPrompt + "\n\n" + reminders.join("\n"),
      message: buildInjectedPromptsMessage(reminders),
    };
  });
}
