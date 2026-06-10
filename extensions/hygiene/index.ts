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

export default function (pi: ExtensionAPI) {
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
    };
  });
}
