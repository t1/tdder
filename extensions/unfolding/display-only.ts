interface ContextEvent {
  messages: Array<{ role: string; customType?: string }>;
}

interface ContextResult {
  messages: Array<{ role: string; customType?: string }>;
}

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
