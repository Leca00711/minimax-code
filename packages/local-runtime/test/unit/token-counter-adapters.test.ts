import type { Api, Model } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';

import { resolveRemoteTokenCounterAdapter } from '../../src/context/token-counter-adapters/registry.js';
import { genericResponsesTokenCounterAdapter } from '../../src/context/token-counter-adapters/responses.js';
import type { RemoteTokenCountContext } from '../../src/context/token-counter-adapters/types.js';

// api.deepseek.com answers 404 for the Responses `input_tokens` endpoint, so a request per turn
// was spent on a guaranteed failure before falling back to local BPE estimation.

function model(overrides: Partial<Model<Api>>): Model<Api> {
  return {
    id: 'model',
    name: 'model',
    api: 'openai-completions',
    provider: 'custom_provider:deepseek',
    baseUrl: 'https://api.deepseek.com',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    ...overrides,
  } as Model<Api>;
}

function context(overrides: Partial<Model<Api>>): RemoteTokenCountContext {
  return { messages: [], model: model(overrides), apiKey: 'test-key' };
}

describe('remote token counter adapter selection', () => {
  it('declines the generic Responses counter for hosts that do not implement input_tokens', () => {
    const ctx = context({ provider: 'custom_provider:deepseek', baseUrl: 'https://api.deepseek.com' });

    expect(genericResponsesTokenCounterAdapter.matches(ctx)).toBe(false);
    expect(resolveRemoteTokenCounterAdapter(ctx)).toBeUndefined();
  });

  it('declines it for the DeepSeek /v1 base URL too', () => {
    expect(
      genericResponsesTokenCounterAdapter.matches(context({ baseUrl: 'https://api.deepseek.com/v1' })),
    ).toBe(false);
  });

  it('keeps the generic Responses counter for OpenAI-compatible hosts that support it', () => {
    const ctx = context({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' });

    expect(genericResponsesTokenCounterAdapter.matches(ctx)).toBe(true);
    expect(resolveRemoteTokenCounterAdapter(ctx)?.id).toBe('generic-responses');
  });

  it('keeps the generic Responses counter when no base URL is declared', () => {
    const ctx = context({ provider: 'custom_provider:other', baseUrl: '' });

    expect(genericResponsesTokenCounterAdapter.matches(ctx)).toBe(true);
  });
});
