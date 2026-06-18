/**
 * Pure helper functions for the /unfold command.
 * Extracted for testability — no pi SDK dependencies.
 */

/** Strip YAML frontmatter (--- ... ---) and return the trimmed markdown body. */
export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return content.trim();
  return match[1].trim();
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
  }

  parts.push("Please pick up where the process left off.");

  return parts.join("\n\n");
}
