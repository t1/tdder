/**
 * Shared context-filter helper for display-only custom messages.
 *
 * pi has no first-class "display-only" flag on custom messages — they always
 * enter the LLM context. This helper filters them out in the `context` event
 * so the LLM never sees them.
 *
 * Usage in an extension:
 *
 *   import { filterDisplayOnlyMessages } from "./vendor/context-filter.ts";
 *
 *   pi.on("context", async (event) =>
 *     filterDisplayOnlyMessages(event, "my-info-type", "my-log-type"),
 *   );
 */

interface ContextEvent {
  messages: Array<{ role: string; customType?: string }>;
}

interface ContextResult {
  messages: Array<{ role: string; customType?: string }>;
}

/**
 * Filter custom messages with the given type(s) out of the LLM context.
 *
 * Returns `undefined` when nothing was filtered (fast path — avoids allocating
 * a new array on every LLM call when there's nothing to remove).
 */
export function filterDisplayOnlyMessages(
  event: ContextEvent,
  ...customTypes: string[]
): ContextResult | undefined {
  const typeSet = customTypes.length > 1 ? new Set(customTypes) : null;
  const match = typeSet
    ? (t: string) => typeSet.has(t)
    : (t: string) => t === customTypes[0];

  const filtered = event.messages.filter(
    (m) => !(m.role === "custom" && match(m.customType ?? "")),
  );

  return filtered.length === event.messages.length ? undefined : { messages: filtered };
}
