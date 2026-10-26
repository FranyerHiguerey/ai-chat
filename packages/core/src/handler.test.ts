import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEnv } from './config.js';
import { ProviderError } from './errors.js';
import { createChatHandler, type ChatHandlerOptions } from './handler.js';
import { staticSource, type SourceData } from './source.js';
import { verifyLeadSignature } from './lead.js';
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

  it('only accepts GET and POST', async () => {
    const { handler } = setup();
    const response = await handler(new Request('http://localhost/api/chat', { method: 'PUT' }));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, POST');
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

describe('createChatHandler guardrails', () => {
  const ip = { clientIp: '203.0.113.7' };

  it('limits requests per IP with a 429 and Retry-After, before calling the provider', async () => {
    const { handler, calls } = setup();
    for (let i = 0; i < 10; i++) expect((await handler(post('{bad'), ip)).status).toBe(400);

    const response = await handler(post(question), ip);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await response.json()).toMatchObject({ error: { code: 'rate_limited' } });
    expect(calls).toHaveLength(0);
    expect((await handler(post(question), { clientIp: '198.51.100.1' })).status).toBe(200);
  });

  it('applies the global ceiling across IPs', async () => {
    const { handler } = setup({}, { config: testConfig({ limits: { rpmGlobal: 2 } }) });
    await handler(post('{bad'), { clientIp: '1.1.1.1' });
    await handler(post('{bad'), { clientIp: '2.2.2.2' });
    expect((await handler(post(question), { clientIp: '3.3.3.3' })).status).toBe(429);
  });

  it('limits concurrent replies and frees the slot when one ends or is stopped', async () => {
    const { handler } = setup({ hang: true, chunks: [] });
    const first = await handler(post(question), ip);
    const second = await handler(post(question), ip);
    expect((await handler(post(question), ip)).status).toBe(429);

    await first.body!.cancel();
    const third = await handler(post(question), ip);
    expect(third.status).toBe(200);
    await second.body!.cancel();
    await third.body!.cancel();
  });

  it('frees the slot after a finished reply and after an early rejection', async () => {
    const { handler } = setup({}, { config: testConfig({ limits: { maxConcurrentPerIp: 1 } }) });
    await (await handler(post(question), ip)).text();
    expect((await handler(post('{bad'), ip)).status).toBe(400);
    expect((await handler(post(question), ip)).status).toBe(200);
  });

  it('rejects other sites with a 403 and no CORS headers', async () => {
    const { handler, calls } = setup();
    const response = await handler(post(question, { headers: { Origin: 'https://evil.example' } }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden_origin' } });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('accepts its own origin and listed origins, with CORS on streams and errors', async () => {
    const site = 'https://www.shop.example';
    const { handler } = setup({}, { config: testConfig({ allowedOrigins: [site] }) });
    const headers = { 'Content-Type': 'application/json', Origin: site };

    const ok = await handler(post(question, { headers }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe(site);
    expect(ok.headers.get('vary')).toBe('Origin');

    const bad = await handler(post('{bad', { headers }));
    expect(bad.headers.get('access-control-allow-origin')).toBe(site);
  });

  it('answers CORS preflight for allowed origins only', async () => {
    const site = 'https://www.shop.example';
    const { handler } = setup({}, { config: testConfig({ allowedOrigins: [site] }) });
    const preflight = (origin: string) =>
      handler(
        new Request('http://localhost/api/chat', {
          method: 'OPTIONS',
          headers: { Origin: origin },
        }),
      );

    const ok = await preflight(site);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-methods')).toBe('POST');
    expect((await preflight('https://evil.example')).status).toBe(403);
  });

  it('rejects oversized bodies and conversations', async () => {
    const { handler, calls } = setup(
      {},
      { config: testConfig({ limits: { maxBodyBytes: 1000, maxConversationChars: 50 } }) },
    );
    const big = await handler(post({ messages: [{ role: 'user', content: 'x'.repeat(2000) }] }));
    expect(big.status).toBe(413);

    const long = {
      messages: [
        { role: 'user', content: 'x'.repeat(30) },
        { role: 'assistant', content: 'y'.repeat(30) },
        { role: 'user', content: 'z' },
      ],
    };
    const response = await handler(post(long));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'message_too_long' } });
    expect(calls).toHaveLength(0);
  });

  it('refuses new chats with a 503 once the daily budget is spent, until the next UTC day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-26T10:00:00Z'));
      // One reply costs 107 weighted tokens (see USAGE).
      const { handler, calls } = setup(
        {},
        { config: testConfig({ limits: { dailyTokenBudget: 100 } }) },
      );
      await (await handler(post(question))).text();

      const response = await handler(post({ ...question, lang: 'en' }));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: 'unavailable' } });
      expect(calls).toHaveLength(1);

      vi.setSystemTime(new Date('2026-10-27T00:00:01Z'));
      expect((await handler(post(question))).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs one entry per request with usage and budget, never the message or the raw IP', async () => {
    const logger = vi.fn();
    const { handler } = setup({}, { logger });
    const secret = 'mi correo es ana@example.com';
    await (await handler(post({ messages: [{ role: 'user', content: secret }] }), ip)).text();
    await handler(post('{bad'), ip);

    const entries = logger.mock.calls.map(([entry]) => entry);
    expect(entries).toEqual([
      expect.objectContaining({
        event: 'ai-chat.request',
        outcome: 'ok',
        status: 200,
        finishReason: 'stop',
        weightedTokens: 107,
        budgetUsedToday: 107,
        ip: expect.stringMatching(/^[0-9a-f]{12}$/),
      }),
      expect.objectContaining({ outcome: 'rejected', status: 400, code: 'invalid_request' }),
    ]);
    const text = JSON.stringify(entries);
    expect(text).not.toContain('ana@example.com');
    expect(text).not.toContain(ip.clientIp);
  });

  it('logs a stopped reply as aborted', async () => {
    const logger = vi.fn();
    const { handler } = setup({ hang: true, chunks: ['Hola'] }, { logger });
    const response = await handler(post(question), ip);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() =>
      expect(logger).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'aborted' })),
    );
  });
});

describe('createChatHandler with a source', () => {
  const doc = (content: string) => ({ file: 'faq.md', content });
  const settings = (name: string) => ({ company: { name, description: 'Envases.' } });

  /** A source whose data the test can change between requests. */
  function mutableSource(initial: SourceData) {
    let data = initial;
    return { source: staticSource(() => data), set: (next: SourceData) => (data = next) };
  }

  const systemOf = (calls: ReturnType<typeof fakeProvider>['calls'], i: number) =>
    calls[i]?.request.system.knowledge ?? '';

  it('answers from the source, overriding company and keeping the deploy limits', async () => {
    const { source } = mutableSource({
      settings: settings('Nova'),
      knowledge: [doc('Envíos: sí.')],
    });
    const { handler, calls } = setup(
      {},
      { source, config: testConfig({ limits: { maxTurns: 1 } }) },
    );
    await (await handler(post(question))).text();

    expect(systemOf(calls, 0)).toContain('Name: Nova');
    expect(systemOf(calls, 0)).toContain('Envíos: sí.');
    const twoTurns = {
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ],
    };
    expect((await handler(post(twoTurns))).status).toBe(400);
  });

  it('ignores keys a dashboard may not set, such as limits', async () => {
    const sneaky = { ...settings('Nova'), limits: { maxTurns: 99 } } as SourceData['settings'];
    const { source } = mutableSource({ settings: sneaky, knowledge: [doc('x')] });
    const { handler } = setup({}, { source, config: testConfig({ limits: { maxTurns: 1 } }) });
    await (await handler(post(question))).text();
    const twoTurns = {
      messages: [question.messages[0], { role: 'assistant', content: 'b' }, question.messages[0]],
    };
    expect((await handler(post(twoTurns))).status).toBe(400);
  });

  it('rebuilds only when the content changes, keeping the prompt bytes stable', async () => {
    const { source, set } = mutableSource({ settings: settings('Nova'), knowledge: [doc('v1')] });
    const { handler, calls } = setup({}, { source });
    await (await handler(post(question))).text();
    await (await handler(post(question))).text();
    expect(calls[1]?.request.system).toBe(calls[0]?.request.system); // same build, same object

    set({ settings: settings('Nova'), knowledge: [doc('v2')] });
    await (await handler(post(question))).text();
    expect(systemOf(calls, 2)).toContain('v2');
  });

  it('keeps serving the last good build when new settings are invalid', async () => {
    const logger = vi.fn();
    const { source, set } = mutableSource({ settings: settings('Nova'), knowledge: [doc('v1')] });
    const { handler, calls } = setup({}, { source, logger });
    await (await handler(post(question))).text();

    set({ settings: { company: { name: '', description: 'x' } }, knowledge: [doc('v2')] });
    const response = await handler(post(question));
    expect(response.status).toBe(200);
    await response.text();
    expect(systemOf(calls, 1)).toContain('v1');
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ai-chat.error',
        stage: 'source',
        message: expect.stringMatching(/company\.name/),
      }),
    );
  });

  it('rejects knowledge over maxKnowledgeChars', async () => {
    const { source } = mutableSource({ knowledge: [doc('x'.repeat(200))] });
    const { handler } = setup(
      {},
      { source, config: testConfig({ limits: { maxKnowledgeChars: 100 } }) },
    );
    expect((await handler(post(question))).status).toBe(500);
  });

  it('serves the public widget settings on GET, cacheable and not rate limited', async () => {
    const widget = { name: 'Nova', greeting: { es: '¡Hola!', en: 'Hi!' } };
    const { source } = mutableSource({
      settings: { ...settings('Nova'), widget },
      knowledge: [doc('x')],
    });
    const { handler, calls } = setup(
      {},
      { source, config: testConfig({ limits: { rpmPerIp: 1 } }) },
    );

    for (let i = 0; i < 3; i++) {
      const response = await handler(new Request('http://localhost/api/chat'), {
        clientIp: '1.1.1.1',
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('public, max-age=60');
      expect(await response.json()).toEqual({ protocol: 1, widget });
    }
    expect(calls).toHaveLength(0);
    expect((await handler(post(question), { clientIp: '1.1.1.1' })).status).toBe(200);
  });

  it('refuses GET from other sites', async () => {
    const { handler } = setup();
    const response = await handler(
      new Request('http://localhost/api/chat', { headers: { Origin: 'https://evil.example' } }),
    );
    expect(response.status).toBe(403);
  });
});

describe('createChatHandler leads', () => {
  const secret = 'whsec_test';
  const leadEnv: ChatEnv = { ...env, leadWebhookSecret: secret };
  const config = testConfig({
    features: { leadCapture: { webhookUrl: 'https://hooks.acme.test/lead' } },
  });
  const lead = {
    lead: { name: 'Ana', email: 'ana@example.com', message: 'Quiero cotizar' },
    transcript: [{ role: 'user', content: 'Necesito 5.000 frascos' }],
    page: 'https://acme.test/productos',
    lang: 'es',
  };

  function leadSetup(webhook: typeof fetch, logger = vi.fn()) {
    const { provider } = fakeProvider();
    const handler = createChatHandler({
      config,
      env: leadEnv,
      provider,
      onUsage: vi.fn(),
      webhookFetch: webhook,
      logger,
    });
    return { handler, logger };
  }

  it('posts a signed lead with the transcript and the company name', async () => {
    const webhook = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const { handler } = leadSetup(webhook);
    const response = await handler(post(lead));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const [url, init] = webhook.mock.calls[0] ?? [];
    expect(url).toBe('https://hooks.acme.test/lead');
    const raw = String(init?.body);
    const headers = init?.headers as Record<string, string>;
    expect(verifyLeadSignature(raw, headers['X-AI-Chat-Signature'], secret)).toBe(true);
    expect(JSON.parse(raw)).toMatchObject({
      event: 'lead',
      site: 'Acme Plastics',
      lead: lead.lead,
      transcript: lead.transcript,
      page: lead.page,
      lang: 'es',
    });
  });

  it('answers 502 lead_failed when the webhook keeps failing, and logs no personal data', async () => {
    const webhook = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 }));
    const { handler, logger } = leadSetup(webhook);
    const response = await handler(post(lead));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: 'lead_failed' } });
    const logs = JSON.stringify(logger.mock.calls);
    expect(logs).toContain('"kind":"lead"');
    expect(logs).not.toContain('ana@example.com');
    expect(logs).not.toContain('5.000 frascos');
  });

  it('rejects invalid leads and leads when capture is off, without calling the webhook', async () => {
    const webhook = vi.fn<typeof fetch>();
    const { handler } = leadSetup(webhook);
    expect((await handler(post({ lead: { name: 'Ana' } }))).status).toBe(400);
    const { handler: off } = setup();
    expect((await off(post(lead))).status).toBe(400);
    expect(webhook).not.toHaveBeenCalled();
  });

  it('refuses to start with lead capture but no signing secret', () => {
    const { provider } = fakeProvider();
    expect(() => createChatHandler({ config, env, provider })).toThrow(
      /AI_CHAT_LEAD_WEBHOOK_SECRET/,
    );
  });
});
