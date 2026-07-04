/**
 * Pure helper functions for the /unfold command.
 * Extracted for testability — no pi SDK dependencies.
 */

/**
 * Resolve a tool allowlist that may contain glob-style wildcards (e.g. `idea_*`)
 * against the live tool names available in the current session.
 *
 * - Static entries (no `*`) pass through unchanged.
 * - Wildcard entries (ending with `*`) are expanded to all live tools whose
 *   names start with the prefix before `*`.
 * - Wildcards that match nothing are silently dropped.
 * - Order follows the allowlist: static entries at their position, wildcard
 *   matches inserted at the wildcard's position.
 */
export function resolveToolAllowlist(allowlist: string[], liveTools: string[]): string[] {
  const result: string[] = [];
  for (const entry of allowlist) {
    if (entry.endsWith("*")) {
      const prefix = entry.slice(0, -1);
      for (const live of liveTools) {
        if (live.startsWith(prefix)) result.push(live);
      }
    } else {
      result.push(entry);
    }
  }
  return result;
}

export const SHARED_PREAMBLE =
  "If achieving a goal requires combining tools in a way that isn't their stated purpose, " +
  "stop and use `task_block` or `ask_sensei` rather than improvising.";

/** Strip YAML frontmatter (--- ... ---) and return the trimmed markdown body. */
export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return content.trim();
  return match[1].trim();
}

/**
 * Parse the optional `tools:` list from YAML frontmatter.
 * Returns the array of tool names when declared, or undefined when the key is absent.
 */
export function parseFrontmatterTools(content: string): string[] | undefined {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return undefined;
  const block = frontmatter[1];
  // Match a `tools:` block followed by indented list items
  const toolsMatch = block.match(/^tools:\s*\n((?:[ \t]+-[ \t]+\S[^\n]*\n?)*)(?=[^\s]|$)/m);
  if (!toolsMatch) return undefined;
  const items = toolsMatch[1]
    .split("\n")
    .map(line => line.replace(/^[ \t]+-[ \t]+/, "").trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export interface UnfoldMessageOptions {
  state: string | null;
  guidance: string | undefined;
}

/** Build the user message that kicks off an /unfold orchestrator turn. */
export function buildUnfoldMessage({ state, guidance }: UnfoldMessageOptions): string {
  const parts: string[] = [];

  if (state) {
    parts.push(`Current state (docs/state.yaml):\n\`\`\`yaml\n${state}\n\`\`\``);
  } else {
    parts.push("No docs/state.yaml found — this appears to be a fresh project.");
  }

  if (guidance) {
    parts.push(`Sensei guidance: ${guidance}`);
  }

  if (!state) {
    parts.push("Fresh-project note: there is no existing code or tech stack to explore yet. Start by creating the product brief, then the first planning artifacts (ATs, rules, indexes, and any genuinely needed DMDs) directly.");
    parts.push("Start the unfolding process now.");
  } else {
    parts.push("Please continue from the current state.");
  }

  return parts.join("\n\n");
}
