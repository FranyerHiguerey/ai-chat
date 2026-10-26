import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { createOpenAIProvider } from './openai.js';

const system = { instructions: 'RULES', knowledge: 'KNOWLEDGE' };
const messages = [
  { role: 'user' as const, content: 'Hi' },
  { role: 'assistant' as const, content: 'Hello!' },
  { role: 'user' as const, content: 'Do you ship?' },
];

type FakeResponse = Pick<
  OpenAI.Responses.Response,
  'model' | 'output' | 'output_text' | 'status' | 'incomplete_details' | 'usage'
>;

function fakeResponse(overrides: Partial<FakeResponse> = {}): FakeResponse {
  return {
    model: 'gpt-test',
    output_text: 'Yes, nationwide.',
    output: [
      {
        type: 'message',
        id: 'msg_1',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'Yes, nationwide.', annotations: [] }],
      },
    ],
    status: 'completed',
    incomplete_details: null,
    usage: {
      input_tokens: 1500,
      input_tokens_details: { cached_tokens: 1280 },
      output_tokens: 6,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 1506,
    },
    ...overrides,
  } as FakeResponse;
}

function setup(response: FakeResponse) {
  const create = vi.fn().mockResolvedValue(response);
  const client = { responses: { create } } as unknown as OpenAI;
  const provider = createOpenAIProvider({ apiKey: 'k', model: 'gpt-test', client });
  return { create, provider };
}

describe('openai provider', () => {
  it('sends instructions first, the conversation as input, and does not store it', async () => {
    const { create, provider } = setup(fakeResponse());
    await provider.complete({ system, messages, maxTokens: 1024 });

    expect(create.mock.calls[0]?.[0]).toEqual({
      model: 'gpt-test',
      instructions: 'RULES\n\nKNOWLEDGE',
      input: messages,
      max_output_tokens: 1024,
      store: false,
    });
  });

  it('reports cached tokens separately from uncached input', async () => {
    const { provider } = setup(fakeResponse());
    expect(await provider.complete({ system, messages, maxTokens: 1024 })).toEqual({
      text: 'Yes, nationwide.',
      toolCalls: [],
      finishReason: 'stop',
      rawStopReason: 'completed',
      usage: {
        provider: 'openai',
        model: 'gpt-test',
        inputTokens: 220,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 1280,
        outputTokens: 6,
      },
    });
  });

  it('maps an output limit to max_tokens', async () => {
    const { provider } = setup(
      fakeResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }),
    );
    const result = await provider.complete({ system, messages, maxTokens: 1024 });
    expect(result.finishReason).toBe('max_tokens');
  });

  it('maps refusal content and content filtering to refusal', async () => {
    const refusal = setup(
      fakeResponse({
        output_text: '',
        output: [
          {
            type: 'message',
            id: 'msg_1',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'refusal', refusal: 'No.' }],
          },
        ],
      }),
    );
    const filtered = setup(
      fakeResponse({ status: 'incomplete', incomplete_details: { reason: 'content_filter' } }),
    );
    for (const { provider } of [refusal, filtered]) {
      const result = await provider.complete({ system, messages, maxTokens: 1024 });
      expect(result.finishReason).toBe('refusal');
    }
  });
});

function streamSetup(events: unknown[]) {
  const create = vi.fn(async () => ({
    async *[Symbol.asyncIterator]() {
      yield* events;
    },
  }));
  const client = { responses: { create } } as unknown as OpenAI;
  const provider = createOpenAIProvider({ apiKey: 'k', model: 'gpt-test', client });
  return { create, provider };
}

async function collect<T>(iterable: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

const delta = (text: string) => ({ type: 'response.output_text.delta', delta: text });

describe('openai provider stream', () => {
  it('forwards text deltas, then done from the completed response', async () => {
    const { create, provider } = streamSetup([
      { type: 'response.created' },
      delta('Yes, '),
      delta('nationwide.'),
      { type: 'response.completed', response: fakeResponse() },
    ]);
    const signal = new AbortController().signal;
    const events = await collect(
      provider.stream({ system, messages, maxTokens: 1024 }, { signal }),
    );

    expect(events).toEqual([
      { type: 'text', text: 'Yes, ' },
      { type: 'text', text: 'nationwide.' },
      {
        type: 'done',
        finishReason: 'stop',
        rawStopReason: 'completed',
        usage: expect.objectContaining({ provider: 'openai', cacheReadInputTokens: 1280 }),
        replay: expect.any(Array),
      },
    ]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ stream: true, store: false }), {
      signal,
    });
  });

  it('never forwards refusal text and reports a refusal', async () => {
    const { provider } = streamSetup([
      { type: 'response.refusal.delta', delta: "I can't help with that." },
      { type: 'response.completed', response: fakeResponse({ output: [], output_text: '' }) },
    ]);
    const events = await collect(provider.stream({ system, messages, maxTokens: 1024 }));
    expect(events).toEqual([expect.objectContaining({ type: 'done', finishReason: 'refusal' })]);
  });

  it('reports max_tokens from an incomplete response', async () => {
    const { provider } = streamSetup([
      delta('Yes'),
      {
        type: 'response.incomplete',
        response: fakeResponse({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
        }),
      },
    ]);
    const events = await collect(provider.stream({ system, messages, maxTokens: 1024 }));
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'max_tokens' });
  });

  it.each([
    [
      'response.failed',
      {
        type: 'response.failed',
        response: { error: { code: 'rate_limit_exceeded', message: 'slow' } },
      },
      'rate_limited',
    ],
    ['an error event', { type: 'error', code: 'server_error', message: 'boom' }, 'unavailable'],
  ])('throws a ProviderError on %s', async (_name, event, code) => {
    const { provider } = streamSetup([delta('Ye'), event]);
    await expect(collect(provider.stream({ system, messages, maxTokens: 1024 }))).rejects.toThrow(
      expect.objectContaining({ name: 'ProviderError', code }),
    );
  });

  it('fails if the stream ends without a final response', async () => {
    const { provider } = streamSetup([delta('Ye')]);
    await expect(collect(provider.stream({ system, messages, maxTokens: 1024 }))).rejects.toThrow(
      expect.objectContaining({ code: 'unavailable' }),
    );
  });
});

describe('openai provider tools', () => {
  const tools = [
    {
      name: 'show_lead_form',
      description: 'Form',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string' } },
        required: ['reason'],
        additionalProperties: false,
      },
    },
  ];
  const call = (args: string) => ({
    type: 'function_call',
    id: 'fc_1',
    call_id: 'call_1',
    name: 'show_lead_form',
    arguments: args,
    status: 'completed',
  });
  const withCalls = (...calls: unknown[]) =>
    fakeResponse({ output: [...fakeResponse().output, ...calls] as FakeResponse['output'] });

  it('sends strict function tools', async () => {
    const { create, provider } = setup(withCalls());
    await provider.complete({ system, messages, maxTokens: 1024, tools });
    expect(create.mock.calls[0]?.[0].tools).toEqual([
      {
        type: 'function',
        name: 'show_lead_form',
        description: 'Form',
        parameters: tools[0]?.parameters,
        strict: true,
      },
    ]);
  });

  it('parses function call arguments and skips malformed ones', async () => {
    const { provider } = setup(withCalls(call('{"reason":"Para cotizar"}'), call('{oops')));
    const result = await provider.complete({ system, messages, maxTokens: 1024, tools });
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'show_lead_form', input: { reason: 'Para cotizar' } },
    ]);
  });

  it('yields tool calls from the final response before done when streaming', async () => {
    const final = withCalls(call('{"reason":"Para cotizar"}'));
    const { provider } = streamSetup([
      delta('Claro.'),
      { type: 'response.completed', response: final },
    ]);
    const events = await collect(provider.stream({ system, messages, maxTokens: 1024, tools }));
    expect(events.map((e) => e.type)).toEqual(['text', 'tool_call', 'done']);
  });
});

describe('openai provider tool rounds', () => {
  it('replays the output items with encrypted reasoning, then one output per call', async () => {
    const { create, provider } = setup(fakeResponse());
    const replay = [
      { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'enc' },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'show_lead_form',
        arguments: '{"reason":"x"}',
      },
    ];
    await provider.complete({
      system,
      messages,
      maxTokens: 1024,
      tools: [{ name: 'show_lead_form', description: 'Form', parameters: {} }],
      rounds: [{ replay, results: [{ id: 'call_1', output: 'Shown' }] }],
    });
    const params = create.mock.calls[0]?.[0];
    expect(params.include).toEqual(['reasoning.encrypted_content']);
    expect(params.input).toEqual([
      ...messages,
      ...replay,
      { type: 'function_call_output', call_id: 'call_1', output: 'Shown' },
    ]);
  });
});
