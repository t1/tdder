// Use the same pi-ai module instance that @earendil-works/pi-coding-agent resolves at runtime.
// Importing @earendil-works/pi-ai directly from the repo root can hit a different module instance,
// which makes faux provider registrations invisible to createAgentSession().
import {
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
} from "../../../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/index.js";

export {
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
};

export function toolResultText(message: any): string {
  return (message?.content ?? [])
    .filter((block: any) => block?.type === "text")
    .map((block: any) => block.text)
    .join("\n");
}

function resolveStep(step: any, context: any, options: any, state: any, model: any) {
  return typeof step === "function"
    ? step(context, options, state, model)
    : step;
}

export function expectLastToolResult(
  expectations: {
    toolName?: string;
    isError?: boolean;
    textIncludes?: string | string[];
    detailsSubset?: Record<string, unknown>;
  },
  nextStep: any,
) {
  return (context: any, options: any, state: any, model: any) => {
    const lastToolResult = [...(context?.messages ?? [])].reverse().find((message: any) => message?.role === "toolResult");
    if (!lastToolResult) throw new Error("Expected a preceding tool result, but context has none");

    if (expectations.toolName !== undefined && lastToolResult.toolName !== expectations.toolName) {
      throw new Error(`Expected last tool result from ${expectations.toolName}, but got ${lastToolResult.toolName}`);
    }
    if (expectations.isError !== undefined && lastToolResult.isError !== expectations.isError) {
      throw new Error(`Expected last tool result isError=${expectations.isError}, but got ${lastToolResult.isError}`);
    }

    const text = toolResultText(lastToolResult);
    for (const expected of Array.isArray(expectations.textIncludes) ? expectations.textIncludes : expectations.textIncludes ? [expectations.textIncludes] : []) {
      if (!text.includes(expected)) {
        throw new Error(`Expected last tool result text to include ${JSON.stringify(expected)}, but was ${JSON.stringify(text)}`);
      }
    }

    if (expectations.detailsSubset) {
      for (const [key, value] of Object.entries(expectations.detailsSubset)) {
        if (lastToolResult.details?.[key] !== value) {
          throw new Error(
            `Expected last tool result details.${key}=${JSON.stringify(value)}, but got ${JSON.stringify(lastToolResult.details?.[key])}`,
          );
        }
      }
    }

    return resolveStep(nextStep, context, options, state, model);
  };
}
