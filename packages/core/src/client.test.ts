import { describe, expect, it, vi } from 'vitest';
import { createChatClient, type ChatStreamEvent } from './client.js';
import type { ChatEnv } from './config.js';
import type { ChatMessage } from './types.js';
import { fakeProvider, testConfig, USAGE } from '../test/helpers.js';

const env: ChatEnv = { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-haiku-5-5' };
const question: ChatMessage[] = [{ role: 'user', content: '¿Hacen envíos?' }];

async function collect(events: AsyncIterable<ChatStreamEvent>) {
  const out: ChatStreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('createChatClient', () => {
  it('passes the prebuilt system prompt, messages and token limit to the provider', async () => {
    const { provider, calls } = fakeProvider();
    const chat = await createChatClient({ config: testConfig(), env, provider, onUsage: vi.fn() });
    await chat.ask(question);
    await collect(chat.stream(question));

    // ask() has no widget to show tool results, so it sends none; stream() does.
    expect(calls[0]?.request).toEqual({ system: chat.system, messages: question, maxTokens: 1024 });
    expect(calls[1]?.request).toEqual({
      system: chat.system,
      messages: question,
      maxTokens: 1024,
      tools: [expect.objectContaining({ name: 'suggest_replies' })],
      rounds: [],
    });
    // Same object every call: the prompt is built once, at startup.
    expect(calls[1]?.request.system).toBe(calls[0]?.request.system);
  });

  describe('ask', () => {
    it('returns the text and reports usage', async () => {
      const { provider } = fakeProvider();
      const onUsage = vi.fn();
      const chat = await createChatClient({ config: testConfig(), env, provider, onUsage });

      expect(await chat.ask(question)).toEqual({
        text: 'Hola, claro.',
        finishReason: 'stop',
        usage: USAGE,
      });
      expect(onUsage).toHaveBeenCalledWith(USAGE);
    });

    it('replaces refusals with a fixed reply in the requested language', async () => {
      const { provider } = fakeProvider({ finishReason: 'refusal', chunks: ['partial'] });
      const chat = await createChatClient({
        config: testConfig(),
        env,
        provider,
        onUsage: vi.fn(),
      });

      const es = await chat.ask(question);
      expect(es.finishReason).toBe('refusal');
      expect(es.text).toMatch(/^Lo siento/);
      expect((await chat.ask(question, { lang: 'en' })).text).toMatch(/^Sorry/);
    });

    it('keeps the partial text when the reply hits max_tokens', async () => {
      const { provider } = fakeProvider({ finishReason: 'max_tokens' });
      const chat = await createChatClient({
        config: testConfig(),
        env,
        provider,
        onUsage: vi.fn(),
      });
      expect(await chat.ask(question)).toMatchObject({
        text: 'Hola, claro.',
        finishReason: 'max_tokens',
      });
    });
  });

  describe('stream', () => {
    it('yields deltas then done, and reports usage once', async () => {
      const { provider } = fakeProvider();
      const onUsage = vi.fn();
      const chat = await createChatClient({ config: testConfig(), env, provider, onUsage });

      expect(await collect(chat.stream(question))).toEqual([
        { type: 'delta', text: 'Hola, ' },
        { type: 'delta', text: 'claro.' },
        { type: 'done', finishReason: 'stop' },
      ]);
      expect(onUsage).toHaveBeenCalledTimes(1);
    });

    it('replaces partial output after a refusal, in the requested language', async () => {
      const { provider } = fakeProvider({ finishReason: 'refusal', chunks: ['partial'] });
      const chat = await createChatClient({
        config: testConfig(),
        env,
        provider,
        onUsage: vi.fn(),
      });

      const events = await collect(chat.stream(question, { lang: 'en' }));
      expect(events.at(-2)).toEqual({ type: 'replace', text: expect.stringMatching(/^Sorry/) });
      expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'refusal' });
    });

    it('passes the abort signal to the provider', async () => {
      const { provider, calls } = fakeProvider();
      const chat = await createChatClient({
        config: testConfig(),
        env,
        provider,
        onUsage: vi.fn(),
      });
      const controller = new AbortController();
      await collect(chat.stream(question, { signal: controller.signal }));
      expect(calls[0]?.signal).toBe(controller.signal);
    });
  });
});

describe('createChatClient knowledge', () => {
  const { provider } = fakeProvider();

  it('uses knowledge passed in instead of the folder', async () => {
    const knowledge = [{ file: 'a.md', content: 'Solo esto.' }];
    const chat = await createChatClient({ config: testConfig(), env, provider, knowledge });
    expect(chat.system.knowledge).toContain('Solo esto.');
    expect(chat.system.knowledge).not.toContain('source="faq.md"');
  });

  it('fails clearly without a knowledge folder or documents', async () => {
    const config = testConfig({ knowledgeDir: undefined });
    await expect(createChatClient({ config, env, provider })).rejects.toThrow(/knowledgeDir/);
    await expect(createChatClient({ config, env, provider, knowledge: [] })).rejects.toThrow(
      /No knowledge documents/,
    );
  });

  it('enforces maxKnowledgeChars', async () => {
    const config = testConfig({ limits: { maxKnowledgeChars: 10 } });
    const knowledge = [{ file: 'a.md', content: 'x'.repeat(11) }];
    await expect(createChatClient({ config, env, provider, knowledge })).rejects.toThrow(
      /maxKnowledgeChars/,
    );
  });
});

describe('createChatClient tools', () => {
  const config = testConfig({
    features: { leadCapture: { webhookUrl: 'https://hooks.acme.test/lead' } },
  });
  const chips = { id: 't1', name: 'suggest_replies', input: { replies: ['¿Precios?'] } };
  const form = { id: 't2', name: 'show_lead_form', input: { reason: 'Para cotizar' } };

  it('turns tool calls into events after the text, each tool once', async () => {
    const { provider } = fakeProvider({ toolCalls: [form, chips, { ...chips, id: 't3' }] });
    const chat = await createChatClient({ config, env, provider, onUsage: vi.fn() });
    expect(await collect(chat.stream(question))).toEqual([
      { type: 'delta', text: 'Hola, ' },
      { type: 'delta', text: 'claro.' },
      { type: 'card', kind: 'lead_form', reason: 'Para cotizar' },
      { type: 'suggestions', items: ['¿Precios?'] },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('drops tool events when the reply is a refusal', async () => {
    const { provider } = fakeProvider({ finishReason: 'refusal', toolCalls: [form] });
    const chat = await createChatClient({ config, env, provider, onUsage: vi.fn() });
    const events = await collect(chat.stream(question, { lang: 'en' }));
    expect(events.map((e) => e.type)).toEqual(['delta', 'delta', 'replace', 'done']);
  });

  it('drops calls with unusable input and logs it without the input', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { provider } = fakeProvider({
      toolCalls: [{ id: 't', name: 'suggest_replies', input: { replies: 'secret' } }],
    });
    const chat = await createChatClient({ config, env, provider, onUsage: vi.fn() });
    const events = await collect(chat.stream(question));
    expect(events.some((e) => e.type === 'suggestions')).toBe(false);
    expect(warn.mock.calls.flat().join(' ')).not.toContain('secret');
    warn.mockRestore();
  });
});

describe('createChatClient tool rounds', () => {
  const config = testConfig({
    features: { leadCapture: { webhookUrl: 'https://hooks.acme.test/lead' } },
  });
  const form = { id: 'call_1', name: 'show_lead_form', input: { reason: 'Para cotizar' } };

  it('continues after a round that only called tools, replaying it with the results', async () => {
    const onUsage = vi.fn();
    const { provider, calls } = fakeProvider({
      rounds: [{ chunks: [], toolCalls: [form] }, { chunks: ['Completa el formulario.'] }],
    });
    const chat = await createChatClient({ config, env, provider, onUsage });
    const events = await collect(chat.stream(question));

    expect(events).toEqual([
      { type: 'delta', text: 'Completa el formulario.' },
      { type: 'card', kind: 'lead_form', reason: 'Para cotizar' },
      { type: 'done', finishReason: 'stop' },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.request.rounds).toEqual([
      { replay: ['round-1'], results: [{ id: 'call_1', output: expect.stringMatching(/^Shown/) }] },
    ]);
    // Same prefix in both rounds, so the second one reads the prompt cache.
    expect(calls[1]?.request.system).toBe(calls[0]?.request.system);
    expect(calls[1]?.request.tools).toEqual(calls[0]?.request.tools);
    // One usage report for the reply, summed over both rounds.
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage.mock.calls[0]?.[0]).toMatchObject({
      outputTokens: 10,
      cacheReadInputTokens: 1800,
    });
  });

  it('needs no second round when the reply already has text', async () => {
    const { provider, calls } = fakeProvider({ toolCalls: [form] });
    const chat = await createChatClient({ config, env, provider, onUsage: vi.fn() });
    await collect(chat.stream(question));
    expect(calls).toHaveLength(1);
  });

  it('stops after two rounds even if the model keeps only calling tools', async () => {
    const { provider, calls } = fakeProvider({ chunks: [], toolCalls: [form] });
    const chat = await createChatClient({ config, env, provider, onUsage: vi.fn() });
    const events = await collect(chat.stream(question));
    expect(calls).toHaveLength(2);
    expect(events.filter((e) => e.type === 'card')).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('tells the model when a call was not shown', async () => {
    const bad = { id: 'call_2', name: 'suggest_replies', input: { replies: 'nope' } };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { provider, calls } = fakeProvider({ rounds: [{ chunks: [], toolCalls: [bad] }, {}] });
    const chat = await createChatClient({ config, env, provider, onUsage: vi.fn() });
    await collect(chat.stream(question));
    expect(calls[1]?.request.rounds?.[0]?.results[0]?.output).toMatch(/^Not shown/);
    vi.restoreAllMocks();
  });
});
