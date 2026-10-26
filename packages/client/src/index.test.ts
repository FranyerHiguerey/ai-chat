import { describe, expect, it, vi } from 'vitest';
import { streamChat, type ChatEvent } from './index.js';

const sse = (body: string, init: ResponseInit = {}) =>
  new Response(body, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
    ...init,
  });

async function run(response: Response | Error, signal?: AbortSignal) {
  const fetch = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const events: ChatEvent[] = [];
  for await (const event of streamChat({
    endpoint: '/api/chat',
    messages: [{ role: 'user', content: 'Hola' }],
    lang: 'es',
    signal,
    fetch,
  })) {
    events.push(event);
  }
  return { events, fetch };
}

const FULL_REPLY = [
  'event: start\ndata: {"id":"1","protocol":1}\n\n',
  ': ping\n\n',
  'event: delta\ndata: {"text":"Hola"}\n\n',
  'event: done\ndata: {"finishReason":"stop"}\n\n',
].join('');

describe('streamChat', () => {
  it('posts the conversation and yields typed events', async () => {
    const { events, fetch } = await run(sse(FULL_REPLY));

    expect(fetch).toHaveBeenCalledWith('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hola' }], lang: 'es' }),
      signal: undefined,
    });
    expect(events).toEqual([
      { type: 'start', id: '1', protocol: 1 },
      { type: 'delta', text: 'Hola' },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('skips unknown events, so newer servers stay compatible', async () => {
    const body = FULL_REPLY.replace(': ping', 'event: suggestions\ndata: {"items":["a"]}');
    const { events } = await run(sse(body));
    expect(events.map((e) => e.type)).toEqual(['start', 'delta', 'done']);
  });

  it('turns a JSON error response into an error event', async () => {
    const body = { error: { code: 'message_too_long', message: 'El mensaje es demasiado largo.' } };
    const { events } = await run(Response.json(body, { status: 400 }));
    expect(events).toEqual([
      { type: 'error', code: 'message_too_long', message: 'El mensaje es demasiado largo.' },
    ]);
  });

  it('reports non-JSON failures and non-SSE responses as bad_response', async () => {
    expect((await run(new Response('Bad gateway', { status: 502 }))).events).toEqual([
      { type: 'error', code: 'bad_response', message: 'HTTP 502' },
    ]);
    expect((await run(new Response('<html>'))).events[0]).toMatchObject({ code: 'bad_response' });
  });

  it('reports a network failure', async () => {
    const { events } = await run(new TypeError('Failed to fetch'));
    expect(events).toEqual([{ type: 'error', code: 'network', message: 'Failed to fetch' }]);
  });

  it('reports a stream that closes before done', async () => {
    const { events } = await run(sse('event: delta\ndata: {"text":"Ho"}\n\n'));
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'network' });
  });

  it('ends quietly when the visitor aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const { events } = await run(abortError, controller.signal);
    expect(events).toEqual([]);
  });
});
