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

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event, ctx) => {
		// Pi's before_provider_request event exposes only the serialized payload.
		// The current model context is the narrowest provider signal the API gives us.
		const provider = typeof ctx.model?.provider === "string" ? ctx.model.provider : undefined;
		return applyMlxRequestDefaults(event.payload, provider);
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
