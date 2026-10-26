import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEnv } from './config.js';
import { ProviderError } from './errors.js';
import { createChatHandler, type ChatHandlerOptions } from './handler.js';
import { fakeProvider, testConfig, type FakeProviderOptions } from '../test/helpers.js';

const env: ChatEnv = { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-haiku-5-5' };
const question = { messages: [{ role: 'user', content: '¿Hacen envíos?' }] };

function setup(fake: FakeProviderOptions = {}, options: Partial<ChatHandlerOptions> = {}) {
  const { provider, calls } = fakeProvider(fake);
  const handler = createChatHandler({
    config: testConfig(),
    env,
    provider,
    onUsage: vi.fn(),
    ...options,
  });
  return { handler, calls };
}

function post(body: unknown, init: RequestInit = {}) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
}

/** Parses a complete SSE body into `{ type, ...data }` events, keeping comments as `comment`. */
async function events(response: Response) {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => {
      if (frame.startsWith(':')) return { type: 'comment', text: frame.slice(2) };
      const [eventLine, dataLine] = frame.split('\n');
      return { type: eventLine?.slice(7), ...JSON.parse(dataLine?.slice(6) ?? '{}') };
    });
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('createChatHandler', () => {
  it('streams start, deltas and done with SSE headers', async () => {
    const { handler } = setup();
    const response = await handler(post(question));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(await events(response)).toEqual([
      { type: 'start', id: expect.any(String), protocol: 1 },
      { type: 'delta', text: 'Hola, ' },
      { type: 'delta', text: 'claro.' },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('sends replace then done on a refusal', async () => {
    const { handler } = setup({ finishReason: 'refusal', chunks: ['partial'] });
    const all = await events(await handler(post({ ...question, lang: 'en' })));
    expect(all.slice(-2)).toEqual([
      { type: 'replace', text: expect.stringMatching(/^Sorry/) },
      { type: 'done', finishReason: 'refusal' },
    ]);
  });

  it('turns a provider failure mid-stream into a localized error event', async () => {
    const { handler } = setup({ error: new ProviderError('rate_limited', '429') });
    const all = await events(await handler(post({ ...question, lang: 'es' })));
    expect(all.at(-1)).toEqual({
      type: 'error',
      code: 'rate_limited',
      message: expect.stringMatching(/muchas consultas/),
    });
    expect(all.some((e) => e.type === 'done')).toBe(false);
  });

  it('hides auth and unknown failures behind internal', async () => {
    const { handler } = setup({ error: new ProviderError('auth', 'invalid x-api-key') });
    const all = await events(await handler(post(question)));
    expect(all.at(-1)).toMatchObject({ type: 'error', code: 'internal' });
    expect(JSON.stringify(all)).not.toContain('x-api-key');
  });

  it('rejects invalid bodies with a 400 before calling the provider', async () => {
    const { handler, calls } = setup();
    const tooLong = { messages: [{ role: 'user', content: 'x'.repeat(2001) }], lang: 'en' };

    const response = await handler(post(tooLong));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'message_too_long', message: expect.stringMatching(/too long/) },
    });
    expect((await handler(post('{not json'))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('only accepts POST', async () => {
    const { handler } = setup();
    const response = await handler(new Request('http://localhost/api/chat'));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('aborts the provider call when the visitor cancels the stream', async () => {
    const { handler, calls } = setup({ hang: true, chunks: ['Hola'] });
    const response = await handler(post(question));
    const reader = response.body!.getReader();
    await reader.read(); // start
    await reader.read(); // first delta
    await reader.cancel();
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('aborts the provider call when the request is aborted', async () => {
    const { handler, calls } = setup({ hang: true, chunks: ['Hola'] });
    const controller = new AbortController();
    const response = await handler(post(question, { signal: controller.signal }));
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    // The stream closes without an error event.
    const rest: string[] = [];
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      rest.push(new TextDecoder().decode(r.value));
    }
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(rest.join('')).not.toContain('event: error');
  });

  it('sends heartbeat comments while waiting', async () => {
    vi.useFakeTimers();
    try {
      const { handler } = setup({ hang: true, chunks: [] }, { heartbeatMs: 1000 });
      const response = await handler(post(question));
      const reader = response.body!.getReader();
      await reader.read(); // start
      await vi.advanceTimersByTimeAsync(1000);
      const { value } = await reader.read();
      expect(new TextDecoder().decode(value)).toBe(': ping\n\n');
      await reader.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns a 500 and retries setup on the next request when the client fails to build', async () => {
    const { provider } = fakeProvider();
    const handler = createChatHandler({
      config: testConfig({ knowledgeDir: '/does/not/exist' }),
      env,
      provider,
      onUsage: vi.fn(),
    });
    const response = await handler(post(question));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: 'internal' } });
    expect((await handler(post(question))).status).toBe(500);
  });
});
