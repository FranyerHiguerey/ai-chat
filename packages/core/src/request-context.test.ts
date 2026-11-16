import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createChatClient, type ChatStreamEvent } from './client.js';
import { validateConfig, type ChatEnv } from './config.js';
import { defineTool } from './custom-tool.js';
import { createChatHandler } from './handler.js';
import { buildSystemPrompt } from './prompt.js';
import { fakeProvider, testConfig } from '../test/helpers.js';

const env: ChatEnv = { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-haiku-5-5' };
const question = [{ role: 'user' as const, content: 'hola' }];

async function collect(stream: AsyncGenerator<ChatStreamEvent>) {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('systemPrompt', () => {
  const docs = [{ file: 'a.md', content: 'x' }];

  it('replaces the website-assistant instructions and keeps tone and tool rules', () => {
    const tool = defineTool({
      name: 'lookup',
      description: 'Looks something up.',
      instructions: 'Use it for every number.',
      parameters: z.object({}),
      run: () => 'ok',
    });
    const config = testConfig({
      systemPrompt: 'You are a coach.',
      languages: { supported: ['en'], default: 'en', tone: 'Direct.' },
      tools: [tool],
    });
    const { instructions } = buildSystemPrompt(config, docs);

    expect(instructions.startsWith('You are a coach.')).toBe(true);
    expect(instructions).not.toContain('website assistant');
    expect(instructions).toContain('- Tone: Direct.');
    expect(instructions).toContain('- lookup: Use it for every number.');
    expect(instructions).toContain('Your own tools may be called as often as the question needs.');
  });

  it('is deploy config: a dashboard cannot set it, and an empty one is invalid', () => {
    expect(validateConfig({ ...testConfig(), systemPrompt: '  ' }).ok).toBe(false);
  });

  it('does not change the prompt of a site that sets none', () => {
    const { instructions } = buildSystemPrompt(testConfig(), docs);
    expect(instructions).toContain('You are the website assistant for Acme Plastics.');
  });
});

describe('limits.maxToolRounds', () => {
  const lookup = defineTool({
    name: 'lookup',
    description: 'Looks something up.',
    parameters: z.object({ n: z.number() }),
    run: ({ n }) => `result ${n}`,
  });
  const toolRound = (n: number) => ({
    chunks: [],
    toolCalls: [{ id: `c${n}`, name: 'lookup', input: { n } }],
  });

  it('allows as many model calls as configured, the last one forced to answer', async () => {
    const config = testConfig({ tools: [lookup], limits: { maxToolRounds: 4 } });
    const { provider, calls } = fakeProvider({
      rounds: [toolRound(1), toolRound(2), toolRound(3), { chunks: ['Listo.'] }],
    });
    const chat = await createChatClient({ config, env, provider, onUsage: vi.fn() });
    const events = await collect(chat.stream(question));

    expect(calls).toHaveLength(4);
    expect(calls[2]?.request.toolChoice).toBeUndefined();
    expect(calls[3]?.request.toolChoice).toBe('none');
    expect(events[0]).toEqual({ type: 'delta', text: 'Listo.' });
  });

  it('is limited to 8', () => {
    expect(validateConfig({ ...testConfig(), limits: { maxToolRounds: 9 } }).ok).toBe(false);
  });
});

describe('limits.maxToolOutputChars', () => {
  const long = defineTool({
    name: 'long_result',
    description: 'Returns a long text.',
    parameters: z.object({}),
    run: () => 'x'.repeat(6_000),
  });

  async function resultSeenByModel(limits: { maxToolOutputChars?: number }) {
    const { provider, calls } = fakeProvider({
      rounds: [
        { chunks: [], toolCalls: [{ id: 'c1', name: 'long_result', input: {} }] },
        { chunks: ['Listo.'] },
      ],
    });
    const config = testConfig({ tools: [long], limits });
    const chat = await createChatClient({ config, env, provider, onUsage: vi.fn() });
    await collect(chat.stream(question));
    return calls[1]?.request.rounds?.[0]?.results[0]?.output ?? '';
  }

  it('cuts a tool result at 4,000 characters unless the site raises the cap', async () => {
    expect(await resultSeenByModel({})).toHaveLength(4_000);
    expect(await resultSeenByModel({ maxToolOutputChars: 8_000 })).toHaveLength(6_000);
  });

  it('stays between 500 and 20,000', () => {
    expect(validateConfig({ ...testConfig(), limits: { maxToolOutputChars: 100 } }).ok).toBe(false);
    expect(validateConfig({ ...testConfig(), limits: { maxToolOutputChars: 30_000 } }).ok).toBe(
      false,
    );
  });
});

describe('request context', () => {
  const draft = z.object({ map: z.string(), rank: z.number().int() });
  let seen: unknown[];
  const readContext = defineTool({
    name: 'read_context',
    description: 'Reads the draft.',
    parameters: z.object({}),
    run: (_input, ctx) => {
      seen.push(ctx.request);
      return JSON.stringify(ctx.request ?? null);
    },
  });

  function setup(options: { contextSchema?: z.ZodType<unknown, z.ZodTypeDef, unknown> } = {}) {
    seen = [];
    const { provider, calls } = fakeProvider({
      rounds: [
        { chunks: [], toolCalls: [{ id: 'c1', name: 'read_context', input: {} }] },
        { chunks: ['Vale.'] },
      ],
    });
    const handler = createChatHandler({
      config: testConfig({ tools: [readContext] }),
      env,
      provider,
      onUsage: vi.fn(),
      ...options,
    });
    return { handler, calls };
  }

  it('validates the context and hands it to the tools, not to the prompt', async () => {
    const { handler, calls } = setup({ contextSchema: draft });
    const response = await handler(
      post({ messages: question, context: { map: 'Dry Season', rank: 18, extra: 'dropped' } }),
    );
    await response.text();

    expect(response.status).toBe(200);
    expect(seen).toEqual([{ map: 'Dry Season', rank: 18 }]);
    expect(JSON.stringify(calls[0]?.request.system)).not.toContain('Dry Season');
    expect(JSON.stringify(calls[0]?.request.messages)).not.toContain('Dry Season');
    expect(calls[1]?.request.rounds?.[0]?.results[0]?.output).toBe(
      '{"map":"Dry Season","rank":18}',
    );
  });

  it('rejects a context that does not match, before any model call', async () => {
    const { handler, calls } = setup({ contextSchema: draft });
    const response = await handler(post({ messages: question, context: { map: 1 } }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect(calls).toHaveLength(0);
  });

  it('rejects a missing context when the schema requires one, and accepts it when optional', async () => {
    const required = setup({ contextSchema: draft });
    expect((await required.handler(post({ messages: question }))).status).toBe(400);

    const optional = setup({ contextSchema: draft.optional() });
    const response = await optional.handler(post({ messages: question }));
    await response.text();
    expect(response.status).toBe(200);
    expect(seen).toEqual([undefined]);
  });

  it('ignores the context when the site sets no schema', async () => {
    const { handler } = setup();
    const response = await handler(post({ messages: question, context: { anything: true } }));
    await response.text();

    expect(response.status).toBe(200);
    expect(seen).toEqual([undefined]);
  });
});

describe('authorize', () => {
  function setup(authorize: NonNullable<Parameters<typeof createChatHandler>[0]['authorize']>) {
    const { provider, calls } = fakeProvider();
    const handler = createChatHandler({
      config: testConfig(),
      env,
      provider,
      onUsage: vi.fn(),
      authorize,
    });
    return { handler, calls };
  }
  const byToken = (request: Request) =>
    request.headers.get('authorization') === 'Bearer good'
      ? { ok: true as const }
      : { ok: false as const };

  it('lets an authorized request through', async () => {
    const { handler } = setup(byToken);
    const response = await handler(post({ messages: question }, { authorization: 'Bearer good' }));
    await response.text();
    expect(response.status).toBe(200);
  });

  it("answers 401 unauthorized in the site's default language, without calling the model", async () => {
    // The body is not read yet, so the visitor's language is not known.
    const { handler, calls } = setup(byToken);
    const response = await handler(
      post({ messages: question, lang: 'en' }, { authorization: 'nope' }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'unauthorized', message: 'No tienes acceso a este chat.' },
    });
    expect(calls).toHaveLength(0);
  });

  it('can answer 403', async () => {
    const { handler } = setup(() => ({ ok: false, status: 403 }));
    expect((await handler(post({ messages: question }))).status).toBe(403);
  });

  it('a throwing hook is a 500, never access', async () => {
    const { handler, calls } = setup(() => {
      throw new Error('token store down');
    });
    expect((await handler(post({ messages: question }))).status).toBe(500);
    expect(calls).toHaveLength(0);
  });

  it('counts denied requests against the rate limit, so guessing tokens is throttled', async () => {
    const { provider } = fakeProvider();
    const handler = createChatHandler({
      config: testConfig({ limits: { rpmPerIp: 2 } }),
      env,
      provider,
      onUsage: vi.fn(),
      authorize: () => ({ ok: false }),
    });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await handler(post({ messages: question }), { clientIp: '1.2.3.4' });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([401, 401, 429]);
  });
});
