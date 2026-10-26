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
      toolCalls: [],
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
        replay: expect.any(Array),
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

describe('anthropic provider tools', () => {
  const tools = [
    {
      name: 'suggest_replies',
      description: 'Chips',
      parameters: {
        type: 'object',
        properties: { replies: { type: 'array', items: { type: 'string' } } },
        required: ['replies'],
        additionalProperties: false,
      },
    },
  ];
  const withTool = fakeResponse({
    content: [
      { type: 'text', text: 'Sí.', citations: null },
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'suggest_replies',
        input: { replies: ['¿Precios?'] },
      },
    ] as Anthropic.Message['content'],
    stop_reason: 'tool_use',
  });

  it('sends strict tools and leaves them out when there are none', async () => {
    const { create, provider } = setup(withTool);
    await provider.complete({ system, messages, maxTokens: 1024, tools });
    expect(create.mock.calls[0]?.[0].tools).toEqual([
      {
        name: 'suggest_replies',
        description: 'Chips',
        input_schema: tools[0]?.parameters,
        strict: true,
      },
    ]);
    await provider.complete({ system, messages, maxTokens: 1024 });
    expect(create.mock.calls[1]?.[0]).not.toHaveProperty('tools');
  });

  it('returns tool calls and treats a tool_use stop as a normal finish', async () => {
    const { provider } = setup(withTool);
    const result = await provider.complete({ system, messages, maxTokens: 1024, tools });
    expect(result.text).toBe('Sí.');
    expect(result.finishReason).toBe('stop');
    expect(result.toolCalls).toEqual([
      { id: 'toolu_1', name: 'suggest_replies', input: { replies: ['¿Precios?'] } },
    ]);
  });

  it('yields tool calls after the text and before done when streaming', async () => {
    const { provider } = streamSetup(withTool);
    const events = await collect(provider.stream({ system, messages, maxTokens: 1024, tools }));
    expect(events.map((e) => e.type)).toEqual(['text', 'text', 'tool_call', 'done']);
    expect(events[2]).toMatchObject({ type: 'tool_call', name: 'suggest_replies' });
  });
});

describe('anthropic provider tool rounds', () => {
  it('replays a round as the assistant content, then all results in one user turn', async () => {
    const { create, provider } = setup(fakeResponse());
    const replay = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 'toolu_1', name: 'show_lead_form', input: { reason: 'x' } },
    ];
    await provider.complete({
      system,
      messages,
      maxTokens: 1024,
      rounds: [{ replay, results: [{ id: 'toolu_1', output: 'Shown' }] }],
    });
    expect(create.mock.calls[0]?.[0].messages).toEqual([
      ...messages,
      { role: 'assistant', content: replay },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Shown' }],
      },
    ]);
  });
});
