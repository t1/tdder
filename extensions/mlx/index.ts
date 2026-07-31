import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const MLX_PROVIDER_NAME = "mlx-lm";
export const MLX_REPETITION_DEFAULTS = Object.freeze({
	repetition_penalty: 1.1,
	repetition_context_size: 128,
});

export function applyMlxRequestDefaults(payload: unknown, provider: unknown): unknown {
	if (provider !== MLX_PROVIDER_NAME) return payload;
	if (!isRecord(payload)) return payload;

	let nextPayload: Record<string, unknown> | undefined;

	for (const [field, value] of Object.entries(MLX_REPETITION_DEFAULTS)) {
		if (Object.prototype.hasOwnProperty.call(payload, field)) continue;
		nextPayload ??= { ...payload };
		nextPayload[field] = value;
	}

	return nextPayload ?? payload;
}

export interface Stall {
	confidence: "xml" | "bare";
}

const TOOL_CALL_MARKUP = /<\/?(?:tool_call|parameter|invoke|function_call)\b/;

export function detectStall(message: unknown): Stall | null {
	if (!isRecord(message)) return null;
	if (message.role !== "assistant") return null;
	if (message.stopReason !== "stop") return null;
	if (!Array.isArray(message.content)) return null;

	const thinkingParts: string[] = [];
	for (const part of message.content) {
		if (!isRecord(part)) return null;
		if (part.type === "thinking" && typeof part.thinking === "string") {
			thinkingParts.push(part.thinking);
		} else {
			return null;
		}
	}
	if (thinkingParts.length === 0) return null;

	const thinking = thinkingParts.join("\n");
	return { confidence: TOOL_CALL_MARKUP.test(thinking) ? "xml" : "bare" };
}

export const STALL_NUDGE =
	"It looks like you tried to call a tool, but the call ended up as raw XML inside your thinking output and was never executed. " +
	"If that's the case, do it properly now: emit the tool call as an actual tool call, not inside thinking. " +
	"Otherwise, continue with your task.";

const MAX_CONSECUTIVE_STALL_RECOVERIES = 2;

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event, ctx) => {
		// Pi's before_provider_request event exposes only the serialized payload.
		// The current model context is the narrowest provider signal the API gives us.
		const provider = typeof ctx.model?.provider === "string" ? ctx.model.provider : undefined;
		return applyMlxRequestDefaults(event.payload, provider);
	});

	let consecutiveStalls = 0;

	pi.on("message_end", (event, ctx) => {
		const provider = typeof ctx.model?.provider === "string" ? ctx.model.provider : undefined;
		if (provider !== MLX_PROVIDER_NAME) return;

		const stall = detectStall(event.message);
		if (!stall) {
			consecutiveStalls = 0;
			return;
		}

		consecutiveStalls += 1;
		if (consecutiveStalls > MAX_CONSECUTIVE_STALL_RECOVERIES) {
			ctx.ui.notify(
				`mlx: model stalled ${consecutiveStalls} times in a row — giving up auto-recovery, please take over`,
				"error",
			);
			return;
		}

		const detail =
			stall.confidence === "xml"
				? "tool-call markup leaked into thinking output"
				: "thinking-only response with no text or tool calls";
		ctx.ui.notify(`mlx: model stalled (${detail}) — nudging it to continue`, "warning");
		pi.sendUserMessage(STALL_NUDGE);
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
