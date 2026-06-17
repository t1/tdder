import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import mlxExtension, {
	applyMlxRequestDefaults,
	MLX_PROVIDER_NAME,
	MLX_REPETITION_DEFAULTS,
} from "../index.ts";

describe("applyMlxRequestDefaults", () => {
	it("leaves unrelated providers unchanged", () => {
		const payload = { messages: [] };

		expect(applyMlxRequestDefaults(payload, "other-provider")).toBe(payload);
	});

	it("injects defaults for the target provider", () => {
		const payload = { messages: [] };

		expect(applyMlxRequestDefaults(payload, MLX_PROVIDER_NAME)).toEqual({
			messages: [],
			...MLX_REPETITION_DEFAULTS,
		});
	});

	it("preserves an existing repetition_penalty", () => {
		const payload = { messages: [], repetition_penalty: 1.3 };

		expect(applyMlxRequestDefaults(payload, MLX_PROVIDER_NAME)).toEqual({
			messages: [],
			repetition_penalty: 1.3,
			repetition_context_size: 128,
		});
	});

	it("preserves an existing repetition_context_size", () => {
		const payload = { messages: [], repetition_context_size: 512 };

		expect(applyMlxRequestDefaults(payload, MLX_PROVIDER_NAME)).toEqual({
			messages: [],
			repetition_penalty: 1.1,
			repetition_context_size: 512,
		});
	});

	it("preserves both existing repetition fields", () => {
		const payload = {
			messages: [],
			repetition_penalty: 1.25,
			repetition_context_size: 256,
		};

		expect(applyMlxRequestDefaults(payload, MLX_PROVIDER_NAME)).toBe(payload);
	});

	it("is a safe no-op for missing or incomplete model context", () => {
		const payload = { messages: [] };

		expect(applyMlxRequestDefaults(payload, undefined)).toBe(payload);
		expect(applyMlxRequestDefaults(payload, null)).toBe(payload);
		expect(applyMlxRequestDefaults(payload, 42)).toBe(payload);
	});

	it("is a safe no-op for non-object payloads", () => {
		expect(applyMlxRequestDefaults(undefined, MLX_PROVIDER_NAME)).toBeUndefined();
		expect(applyMlxRequestDefaults(null, MLX_PROVIDER_NAME)).toBeNull();
		expect(applyMlxRequestDefaults("payload", MLX_PROVIDER_NAME)).toBe("payload");
		expect(applyMlxRequestDefaults(["payload"], MLX_PROVIDER_NAME)).toEqual(["payload"]);
	});
});

describe("mlx extension hook wiring", () => {
	it("registers a before_provider_request handler that rewrites only the target provider", () => {
		const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
		const pi = {
			on(eventName: string, handler: (event: unknown, ctx: unknown) => unknown) {
				const existing = handlers.get(eventName) ?? [];
				existing.push(handler);
				handlers.set(eventName, existing);
			},
		} as unknown as ExtensionAPI;

		mlxExtension(pi);

		const beforeProviderRequestHandlers = handlers.get("before_provider_request");
		expect(beforeProviderRequestHandlers).toHaveLength(1);

		const handler = beforeProviderRequestHandlers?.[0];
		expect(handler).toBeTypeOf("function");

		const targetPayload = { messages: [] };
		expect(handler?.({ payload: targetPayload }, { model: { provider: MLX_PROVIDER_NAME } })).toEqual({
			messages: [],
			...MLX_REPETITION_DEFAULTS,
		});

		const otherPayload = { messages: [] };
		expect(handler?.({ payload: otherPayload }, { model: { provider: "other-provider" } })).toBe(otherPayload);

		const missingModelPayload = { messages: [] };
		expect(handler?.({ payload: missingModelPayload }, {})).toBe(missingModelPayload);

		const invalidProviderPayload = { messages: [] };
		expect(handler?.({ payload: invalidProviderPayload }, { model: { provider: 42 } })).toBe(invalidProviderPayload);
	});
});
