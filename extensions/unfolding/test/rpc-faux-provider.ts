import { readFileSync } from "node:fs";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions, ToolCall } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ScriptAction =
  | { type: "tool"; name: string; arguments?: Record<string, unknown> }
  | { type: "abort"; errorMessage?: string }
  | { type: "hangUntilAbort"; errorMessage?: string }
  | { type: "text"; text: string };

let loadedFrom: string | undefined;
let scriptedActions: ScriptAction[] = [];
let nextActionIndex = 0;

function loadScript(): void {
  const scriptPath = process.env.UNFOLDING_RPC_FAUX_SCRIPT;
  if (!scriptPath) throw new Error("UNFOLDING_RPC_FAUX_SCRIPT is not set");
  if (loadedFrom === scriptPath) return;

  const parsed = JSON.parse(readFileSync(scriptPath, "utf8")) as ScriptAction[];
  if (!Array.isArray(parsed)) throw new Error(`Expected scripted actions array in ${scriptPath}`);
  loadedFrom = scriptPath;
  scriptedActions = parsed;
  nextActionIndex = 0;
}

function takeNextAction(): ScriptAction {
  loadScript();
  const action = scriptedActions[nextActionIndex++];
  if (!action) {
    throw new Error(`No scripted response left at index ${nextActionIndex - 1}`);
  }
  return action;
}

function emptyAssistant(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function streamScripted(
  model: Model<Api>,
  _context: Context,
  options?: SimpleStreamOptions,
) {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output = emptyAssistant(model);
    let action: ScriptAction | undefined;

    try {
      action = takeNextAction();
      stream.push({ type: "start", partial: output });

      if (action.type === "tool") {
        const toolCall: ToolCall = {
          type: "toolCall",
          id: `rpc-faux-tool-${nextActionIndex}`,
          name: action.name,
          arguments: action.arguments ?? {},
        };
        output.content.push(toolCall);
        stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
        stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
        output.stopReason = "toolUse";
        stream.push({ type: "done", reason: "toolUse", message: output });
        stream.end(output);
        return;
      }

      if (action.type === "hangUntilAbort") {
        const onAbort = () => {
          output.stopReason = "aborted";
          output.errorMessage = action.errorMessage ?? "aborted";
          stream.push({ type: "error", reason: "aborted", error: output });
          stream.end(output);
        };

        if (options?.signal?.aborted) {
          onAbort();
          return;
        }

        options?.signal?.addEventListener("abort", onAbort, { once: true });
        return;
      }

      if (action.type === "text") {
        output.content.push({ type: "text", text: action.text });
        stream.push({ type: "text_start", contentIndex: 0, partial: output });
        stream.push({ type: "text_delta", contentIndex: 0, delta: action.text, partial: output });
        stream.push({ type: "text_end", contentIndex: 0, content: action.text, partial: output });
        output.stopReason = "stop";
        stream.push({ type: "done", reason: "stop", message: output });
        stream.end(output);
        return;
      }

      throw new Error(action.errorMessage ?? "Request was aborted.");
    } catch (error) {
      output.stopReason = action?.type === "abort" || options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end(output);
    }
  })();

  return stream;
}

export default function (pi: ExtensionAPI) {
  pi.registerProvider("rpc-faux", {
    api: "rpc-faux-api",
    baseUrl: "https://example.invalid/rpc-faux",
    apiKey: "$RPC_FAUX_API_KEY",
    models: [
      {
        id: "scripted-test-model",
        name: "RPC Faux Scripted Test Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32000,
        maxTokens: 4000,
      },
    ],
    streamSimple: streamScripted,
  });
}
