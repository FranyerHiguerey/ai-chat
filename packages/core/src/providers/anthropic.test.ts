import AnthropicSdk from '@anthropic-ai/sdk';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider } from './anthropic.js';

const system = { instructions: 'RULES', knowledge: 'KNOWLEDGE' };
const messages = [{ role: 'user' as const, content: '¿Hacen envíos?' }];

function fakeResponse(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [
      { type: 'text', text: 'Hola, ', citations: null },
      { type: 'text', text: 'claro.', citations: null },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 12,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 900,
    },
    ...overrides,
  } as Anthropic.Message;
}

function setup(response: Anthropic.Message) {
  const create = vi.fn().mockResolvedValue(response);
  const client = { messages: { create } } as unknown as Anthropic;
  const provider = createAnthropicProvider({ apiKey: 'k', model: 'claude-haiku-5-5', client });
  return { create, provider };
}

describe('anthropic provider', () => {
  it('caches the system prompt, uses low effort and sends no sampling params', async () => {
    const { create, provider } = setup(fakeResponse());
    await provider.complete({ system, messages, maxTokens: 1024 });

    const params = create.mock.calls[0]?.[0];
    expect(params).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 1024,
      system: [
        { type: 'text', text: 'RULES' },
        { type: 'text', text: 'KNOWLEDGE', cache_control: { type: 'ephemeral' } },
      ],
      messages,
      output_config: { effort: 'low' },
    });
  });

  it('joins text blocks and normalizes usage', async () => {
    const { provider } = setup(fakeResponse());
    expect(await provider.complete({ system, messages, maxTokens: 1024 })).toEqual({
      text: 'Hola, claro.',
      finishReason: 'stop',
      rawStopReason: 'end_turn',
      usage: {
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        inputTokens: 12,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 900,
        outputTokens: 5,
      },
    });
  });

  it.each([
    ['refusal', 'refusal'],
    ['max_tokens', 'max_tokens'],
  ] as const)('maps stop_reason %s to %s', async (stopReason, expected) => {
    const { provider } = setup(fakeResponse({ stop_reason: stopReason }));
    const result = await provider.complete({ system, messages, maxTokens: 1024 });
    expect(result.finishReason).toBe(expected);
  });
});

function streamSetup(response: Anthropic.Message, options: { failWith?: unknown } = {}) {
  const events = [
    { type: 'message_start' },
    { type: 'content_block_start', index: 0 },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hola, ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'claro.' } },
    { type: 'message_stop' },
  ];
  const stream = vi.fn(() => ({
    async *[Symbol.asyncIterator]() {
      yield* events.slice(0, 3);
      if (options.failWith) throw options.failWith;
      yield* events.slice(3);
    },
    finalMessage: async () => response,
  }));
  const client = { messages: { stream } } as unknown as Anthropic;
  const provider = createAnthropicProvider({ apiKey: 'k', model: 'claude-haiku-5-5', client });
  return { stream, provider };
}

async function collect<T>(iterable: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('anthropic provider stream', () => {
  it('forwards only text deltas, then done from the final message', async () => {
    const { stream, provider } = streamSetup(fakeResponse());
    const signal = new AbortController().signal;
    const events = await collect(
      provider.stream({ system, messages, maxTokens: 1024 }, { signal }),
    );

    expect(events).toEqual([
      { type: 'text', text: 'Hola, ' },
      { type: 'text', text: 'claro.' },
      {
        type: 'done',
        finishReason: 'stop',
        rawStopReason: 'end_turn',
        usage: expect.objectContaining({ provider: 'anthropic', cacheReadInputTokens: 900 }),
      },
    ]);
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({ output_config: { effort: 'low' } }),
      { signal },
    );
  });

  it('reports a refusal at the end of the stream', async () => {
    const { provider } = streamSetup(fakeResponse({ stop_reason: 'refusal' }));
    const events = await collect(provider.stream({ system, messages, maxTokens: 1024 }));
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'refusal' });
  });

  it('maps SDK errors thrown mid-stream to ProviderError', async () => {
    const failWith = new AnthropicSdk.RateLimitError(429, undefined, 'slow', new Headers());
    const { provider } = streamSetup(fakeResponse(), { failWith });
    await expect(collect(provider.stream({ system, messages, maxTokens: 1024 }))).rejects.toThrow(
      expect.objectContaining({ name: 'ProviderError', code: 'rate_limited' }),
    );
  });
});
