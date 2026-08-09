import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import mlxExtension, {
	detectStall,
	MLX_PROVIDER_NAME,
} from "../index.ts";

describe("detectStall", () => {
	it("returns null for non-assistant roles", () => {
		expect(detectStall({ role: "user", content: "hi" })).toBeNull();
		expect(detectStall({ role: "toolResult", content: [] })).toBeNull();
	});

	it("returns null for assistant messages with text or tool calls", () => {
		const withText = {
			role: "assistant",
			stopReason: "stop",
			content: [
				{ type: "thinking", thinking: "hmm" },
				{ type: "text", text: "Hello!" },
			],
		};
		const withToolCall = {
			role: "assistant",
			stopReason: "toolUse",
			content: [
				{ type: "thinking", thinking: "hmm" },
				{ type: "toolCall", name: "bash", arguments: {} },
			],
		};

		expect(detectStall(withText)).toBeNull();
		expect(detectStall(withToolCall)).toBeNull();
	});

	it("returns null for thinking-only messages without a 'stop' reason", () => {
		const aborted = {
			role: "assistant",
			stopReason: "aborted",
			content: [{ type: "thinking", thinking: "<tool_call>..." }],
		};

		expect(detectStall(aborted)).toBeNull();
	});

	it("detects an xml-confidence stall from a <tool_call> fragment in thinking", () => {
		const stalled = {
			role: "assistant",
			stopReason: "stop",
			content: [
				{
					type: "thinking",
					thinking: "Let me rewrite the file.\n<tool_call>\n<parameter=path>foo.ts</parameter>\n</tool_call>",
				},
			],
		};

		expect(detectStall(stalled)).toEqual({ confidence: "xml" });
	});

	it("detects an xml-confidence stall from a lone closing tag", () => {
		const stalled = {
			role: "assistant",
			stopReason: "stop",
			content: [{ type: "thinking", thinking: "Let me fix the TodoResource.\n</parameter>" }],
		};

		expect(detectStall(stalled)).toEqual({ confidence: "xml" });
	});

	it("detects a bare stall from clean thinking-only output", () => {
		const stalled = {
			role: "assistant",
			stopReason: "stop",
			content: [{ type: "thinking", thinking: "I am not sure what to do next." }],
		};

		expect(detectStall(stalled)).toEqual({ confidence: "bare" });
	});
});

function createPiSpy(provider: string = MLX_PROVIDER_NAME) {
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
	const notifications: Array<{ message: string; level: string }> = [];
	const sentMessages: string[] = [];
	const pi = {
		on(eventName: string, handler: (event: unknown, ctx: unknown) => unknown) {
			const existing = handlers.get(eventName) ?? [];
			existing.push(handler);
			handlers.set(eventName, existing);
		},
		sendUserMessage(message: string) {
			sentMessages.push(message);
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		model: { provider },
		ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
	};
	return { handlers, notifications, sentMessages, pi, ctx };
}

function stalledEvent() {
	return {
		message: {
			role: "assistant",
			stopReason: "stop",
			content: [{ type: "thinking", thinking: "<tool_call>\n<parameter=path>x</parameter>\n</tool_call>" }],
		},
	};
}

describe("stall recovery", () => {
	it("ignores stalls from non-mlx providers", () => {
		const { handlers, notifications, sentMessages, pi, ctx } = createPiSpy("anthropic");
		mlxExtension(pi);

		handlers.get("message_end")?.[0]?.(stalledEvent(), ctx);

		expect(notifications).toEqual([]);
		expect(sentMessages).toEqual([]);
	});

	it("notifies and nudges on an xml-confidence stall", () => {
		const { handlers, notifications, sentMessages, pi, ctx } = createPiSpy();
		mlxExtension(pi);

		handlers.get("message_end")?.[0]?.(stalledEvent(), ctx);

		expect(notifications).toHaveLength(1);
		expect(notifications[0]?.level).toBe("warning");
		expect(sentMessages).toHaveLength(1);
		expect(sentMessages[0]).toContain("tool");
	});

	it("stops nudging after two consecutive stalls", () => {
		const { handlers, notifications, sentMessages, pi, ctx } = createPiSpy();
		mlxExtension(pi);

		const messageEnd = handlers.get("message_end")?.[0];
		messageEnd?.(stalledEvent(), ctx);
		messageEnd?.(stalledEvent(), ctx);
		messageEnd?.(stalledEvent(), ctx);

		expect(sentMessages).toHaveLength(2);
		expect(notifications.at(-1)?.level).toBe("error");
	});

	it("resets the stall counter after a healthy assistant message", () => {
		const { handlers, sentMessages, pi, ctx } = createPiSpy();
		mlxExtension(pi);

		const messageEnd = handlers.get("message_end")?.[0];
		const healthy = {
			message: {
				role: "assistant",
				stopReason: "stop",
				content: [{ type: "text", text: "done" }],
			},
		};

		messageEnd?.(stalledEvent(), ctx);
		messageEnd?.(stalledEvent(), ctx);
		messageEnd?.(healthy, ctx);
		messageEnd?.(stalledEvent(), ctx);
		messageEnd?.(stalledEvent(), ctx);

		expect(sentMessages).toHaveLength(4);
	});
});

