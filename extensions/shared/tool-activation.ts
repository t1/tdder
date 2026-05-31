/**
 * Shared helper to toggle an extension's tools on/off in the active tool set.
 *
 * When `active` is true, adds the extension's tools (that are registered) to
 * the active set. When false, removes them. Other extensions' tools are
 * preserved in both cases.
 *
 * Usage:
 *
 *   import { setToolsActive } from "./vendor/tool-activation.ts";
 *
 *   setToolsActive(pi, MY_TOOL_NAMES, connected);
 */

interface ToolRegistry {
  getAllTools(): Array<{ name: string }>;
  getActiveTools(): string[];
  setActiveTools(names: string[]): void;
}

export function setToolsActive(
  pi: ToolRegistry,
  toolNames: string[],
  active: boolean,
): void {
  const others = pi.getActiveTools().filter((n) => !toolNames.includes(n));
  if (active) {
    const registered = new Set(pi.getAllTools().map((t) => t.name));
    const present = toolNames.filter((n) => registered.has(n));
    pi.setActiveTools([...others, ...present]);
  } else {
    pi.setActiveTools(others);
  }
}
