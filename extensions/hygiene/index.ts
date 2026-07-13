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

import { existsSync, readFileSync, globSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { filterDisplayOnlyMessages } from "../shared/context-filter.ts";

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

export default function (pi: ExtensionAPI) {
  pi.on("context", async (event) =>
    filterDisplayOnlyMessages(event, INJECTED_PROMPTS_MSG_TYPE) as { messages?: any[] } | undefined,
  );

  pi.registerMessageRenderer<{ reminders?: string[] }>(INJECTED_PROMPTS_MSG_TYPE, (message, _options, theme) => {
    const reminders = message.details?.reminders ?? [];
    const text = [
      theme.fg("muted", "Injected prompts:"),
      ...reminders.map((reminder) => theme.fg("muted", `- ${reminder}`)),
    ].join("\n");
    return new Text(text, 0, 0);
  });

  pi.on("before_agent_start", async (event) => {
    const cwd = event.systemPromptOptions.cwd ?? "";
    const loaded = new Set(event.systemPromptOptions.skills?.map((s) => s.name) ?? []);

    const reminders: string[] = [];

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
