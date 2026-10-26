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

    expect(calls[0]?.request).toEqual({ system: chat.system, messages: question, maxTokens: 1024 });
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
