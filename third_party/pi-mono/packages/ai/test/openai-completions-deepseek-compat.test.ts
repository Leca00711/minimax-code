import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.ts";
import { streamSimple } from "../src/stream.ts";

// DeepSeek-specific OpenAI-completions compat:
//
// 1. DeepSeek honors `max_tokens` and silently ignores `max_completion_tokens`, so an output
//    limit sent as `max_completion_tokens` never applies (verified against api.deepseek.com:
//    a 16-token cap produced 26 completion tokens). The field must therefore be `max_tokens`
//    for both the catalog entries and any BYOK provider pointing at api.deepseek.com.
// 2. DeepSeek V4 accepts `reasoning_effort: "low"` and measurably reduces reasoning tokens
//    (~30% fewer than `high`), so the level map exposes it instead of `null`.

const mockState = vi.hoisted(() => ({
	lastParams: undefined as unknown,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: (params: unknown) => {
					mockState.lastParams = params;
					const stream = {
						async *[Symbol.asyncIterator]() {
							yield {
								choices: [{ delta: {}, finish_reason: "stop" }],
								usage: {
									prompt_tokens: 1,
									completion_tokens: 1,
									prompt_tokens_details: { cached_tokens: 0 },
									completion_tokens_details: { reasoning_tokens: 0 },
								},
							};
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{
							data: typeof stream;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}

	return { default: FakeOpenAI };
});

describe("deepseek openai-completions compat", () => {
	beforeEach(() => {
		mockState.lastParams = undefined;
	});

	it("declares max_tokens and exposes the low reasoning level for DeepSeek V4", () => {
		for (const id of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
			const model = getModel("deepseek", id)!;
			expect(model.compat?.maxTokensField).toBe("max_tokens");
			expect(model.compat?.requiresReasoningContentOnAssistantMessages).toBe(true);
			expect(model.compat?.thinkingFormat).toBe("deepseek");
			expect(model.thinkingLevelMap?.low).toBe("low");
			expect(model.thinkingLevelMap?.high).toBe("high");
			expect(model.thinkingLevelMap?.xhigh).toBe("max");
		}
	});

	it("sends max_tokens (not max_completion_tokens) for the catalog DeepSeek models", async () => {
		const model = getModel("deepseek", "deepseek-v4-flash")!;

		await streamSimple(
			model,
			{ messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
			{ apiKey: "test", maxTokens: 1234 },
		).result();

		const params = mockState.lastParams as { max_tokens?: number; max_completion_tokens?: number };
		expect(params.max_tokens).toBe(1234);
		expect(params.max_completion_tokens).toBeUndefined();
	});

	it("derives max_tokens for BYOK providers pointing at api.deepseek.com without compat", async () => {
		const { compat: _compat, ...baseModel } = getModel("deepseek", "deepseek-v4-pro")!;
		const model = {
			...baseModel,
			provider: "custom_provider:deepseek",
			baseUrl: "https://api.deepseek.com",
		} as const;

		await streamSimple(
			model,
			{ messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
			{ apiKey: "test", maxTokens: 4321, reasoning: "high" },
		).result();

		const params = mockState.lastParams as {
			thinking?: unknown;
			max_tokens?: number;
			max_completion_tokens?: number;
			reasoning_effort?: string;
		};
		expect(params.max_tokens).toBe(4321);
		expect(params.max_completion_tokens).toBeUndefined();
		// The DeepSeek thinking format is derived from the base URL too.
		expect(params.thinking).toEqual({ type: "enabled" });
		expect(params.reasoning_effort).toBe("high");
	});

	it("forwards the low reasoning level to reasoning_effort", async () => {
		const model = getModel("deepseek", "deepseek-v4-flash")!;

		await streamSimple(
			model,
			{ messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
			{ apiKey: "test", reasoning: "low" },
		).result();

		const params = mockState.lastParams as { thinking?: unknown; reasoning_effort?: string };
		expect(params.thinking).toEqual({ type: "enabled" });
		expect(params.reasoning_effort).toBe("low");
	});

	it("replays reasoning_content on assistant tool-call messages", async () => {
		const model = getModel("deepseek", "deepseek-v4-flash")!;

		await streamSimple(
			model,
			{
				messages: [
					{ role: "user", content: "use the tool", timestamp: Date.now() },
					{
						role: "assistant",
						content: [
							{
								type: "thinking",
								thinking: "I should call noop.",
								thinkingSignature: "reasoning_content",
							},
							{ type: "toolCall", id: "t1", name: "noop", arguments: {} },
						],
						stopReason: "toolUse",
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
						api: "openai-completions",
						provider: "deepseek",
						model: "deepseek-v4-flash",
						timestamp: Date.now(),
					},
					{
						role: "toolResult",
						toolCallId: "t1",
						toolName: "noop",
						content: [{ type: "text", text: "done" }],
						isError: false,
						timestamp: Date.now(),
					},
				],
			},
			{ apiKey: "test", reasoning: "high" },
		).result();

		const params = mockState.lastParams as {
			messages: Array<{ role: string; reasoning_content?: string }>;
		};
		const assistant = params.messages.find(message => message.role === "assistant");
		expect(assistant?.reasoning_content).toBe("I should call noop.");
	});
});
