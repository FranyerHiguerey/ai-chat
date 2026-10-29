import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createChatClient, type ChatStreamEvent } from './client.js';
import { validateConfig, type ChatEnv } from './config.js';
import { customToolSpec, defineTool, runCustomTool } from './custom-tool.js';
import { buildSystemPrompt } from './prompt.js';
import { fakeProvider, testConfig } from '../test/helpers.js';

const env: ChatEnv = { provider: 'openai', apiKey: 'sk-test', model: 'gpt-test' };
const question = [{ role: 'user' as const, content: '¿Cuánto cuesta el litro de 70 g?' }];

const quote = defineTool({
  name: 'quote_by_weight',
  description: 'Price of a container made at another weight.',
  instructions: 'Use it whenever the visitor asks for a weight other than the standard one.',
  parameters: z.object({ product: z.string(), grams: z.number().positive() }),
  run: ({ product, grams }) => `${product} at ${grams} g: $${((0.41 / 61) * grams).toFixed(2)}`,
});

const call = (input: unknown) => ({ id: 'call_1', name: 'quote_by_weight', input });

async function collect(events: AsyncIterable<ChatStreamEvent>) {
  const out: ChatStreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe('custom tools: config', () => {
  it('turns the Zod parameters into a strict JSON Schema, like the built-in tools', () => {
    expect(customToolSpec(quote)).toEqual({
      name: 'quote_by_weight',
      description: 'Price of a container made at another weight.',
      parameters: {
        type: 'object',
        properties: { product: { type: 'string' }, grams: { type: 'number', exclusiveMinimum: 0 } },
        required: ['product', 'grams'],
        additionalProperties: false,
      },
    });
  });

  it('rejects built-in names, duplicates, bad names and non-Zod parameters', () => {
    const issues = (tools: unknown[]) => {
      const result = validateConfig({ ...testConfig(), tools });
      return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
    };
    expect(issues([{ ...quote, name: 'search_catalog' }])).toEqual([
      'tools.0.name: is a built-in tool name',
    ]);
    expect(issues([quote, quote])).toEqual(['tools: Tool names must be unique']);
    expect(issues([{ ...quote, name: 'Quote-Price' }])[0]).toMatch(/snake_case/);
    expect(issues([{ ...quote, parameters: { type: 'object' } }])[0]).toMatch(/Zod object/);
    expect(issues([quote])).toEqual([]);
    // Another copy of zod (the site's own) is accepted: the check is structural.
    const foreign = Object.create(null) as Record<string, unknown>;
    Object.assign(foreign, {
      _def: quote.parameters._def,
      safeParse: quote.parameters.safeParse.bind(quote.parameters),
    });
    expect(issues([{ ...quote, parameters: foreign }])).toEqual([]);
  });

  it('is offered after the built-in tools, with its instructions in the prompt', async () => {
    const config = testConfig({ tools: [quote] });
    const { provider, calls } = fakeProvider();
    const chat = await createChatClient({ config, env, provider, onUsage: vi.fn() });
    await collect(chat.stream(question));
    expect(calls[0]?.request.tools?.map((tool) => tool.name)).toEqual([
      'suggest_replies',
      'quote_by_weight',
    ]);
    expect(JSON.stringify(buildSystemPrompt(config, [{ file: 'a.md', content: 'x' }]))).toContain(
      '- quote_by_weight: Use it whenever the visitor asks for a weight other than the standard one.',
    );
  });
});

describe('runCustomTool', () => {
  it('validates the arguments and returns the text', async () => {
    expect(
      await runCustomTool(quote, call({ product: 'Litro A1', grams: 70 }), { catalog: [] }),
    ).toBe('Litro A1 at 70 g: $0.47');
    expect(
      await runCustomTool(quote, call({ product: 'Litro A1', grams: -5 }), { catalog: [] }),
    ).toMatch(/^Invalid arguments: grams /);
  });

  it('awaits async tools and passes the catalog', async () => {
    const run = vi.fn(
      async (_input: { id: string }, ctx: { catalog: unknown[] }) => `${ctx.catalog.length} items`,
    );
    const tool = defineTool({
      name: 'count',
      description: 'd',
      parameters: z.object({ id: z.string() }),
      run,
    });
    const catalog = [{ id: 'a', name: 'A', tags: [], attributes: {} }];
    expect(await runCustomTool(tool, call({ id: 'x' }), { catalog })).toBe('1 items');
  });

  it('turns a thrown error into a short result and logs the message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tool = defineTool({
      name: 'broken',
      description: 'd',
      parameters: z.object({}),
      run: () => {
        throw new Error('database down');
      },
    });
    expect(await runCustomTool(tool, call({}), { catalog: [] })).toMatch(/^The tool failed/);
    expect(log.mock.calls[0]?.[0]).toContain('database down');
  });

  it('gives up on a tool that hangs', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const tool = defineTool({
      name: 'slow',
      description: 'd',
      parameters: z.object({}),
      run: () => new Promise<string>(() => {}),
    });
    const controller = new AbortController();
    const result = runCustomTool(tool, call({}), { catalog: [], signal: controller.signal });
    controller.abort();
    expect(await result).toMatch(/^The tool failed/);
    vi.useRealTimers();
  });
});

describe('custom tools: rounds', () => {
  it('feeds the result back to the model, allowing a third round for search, then calculate, then answer', async () => {
    const config = testConfig({ tools: [quote] });
    const { provider, calls } = fakeProvider({
      rounds: [
        { chunks: [], toolCalls: [call({ product: 'Litro A1', grams: 70 })] },
        {
          chunks: [],
          toolCalls: [
            { id: 'call_2', name: 'quote_by_weight', input: { product: 'Litro A1', grams: 80 } },
          ],
        },
        { chunks: ['Cuesta $0.47.'] },
      ],
    });
    const chat = await createChatClient({ config, env, provider, onUsage: vi.fn() });
    const events = await collect(chat.stream(question));

    expect(calls).toHaveLength(3);
    expect(calls[1]?.request.rounds?.[0]?.results).toEqual([
      { id: 'call_1', output: 'Litro A1 at 70 g: $0.47' },
    ]);
    expect(calls[2]?.request.toolChoice).toBe('none');
    // Nothing is shown to the visitor: only the answer.
    expect(events).toEqual([
      { type: 'delta', text: 'Cuesta $0.47.' },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('keeps two rounds for sites without custom tools', async () => {
    const { provider, calls } = fakeProvider({
      chunks: [],
      toolCalls: [{ id: 'c', name: 'suggest_replies', input: { replies: ['a'] } }],
    });
    const chat = await createChatClient({ config: testConfig(), env, provider, onUsage: vi.fn() });
    await collect(chat.stream(question));
    expect(calls).toHaveLength(2);
  });
});
