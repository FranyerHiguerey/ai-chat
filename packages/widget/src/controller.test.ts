import { describe, expect, it, vi } from 'vitest';
import { frame, openStream, reply, sse } from '../test/sse.js';
import { ChatController, restoreMessages } from './controller.js';
import { memoryStore } from './store.js';
import { createMessage, textOf } from './types.js';

function setup(fetch: typeof globalThis.fetch, store = memoryStore()) {
  const onMessage = vi.fn();
  const onError = vi.fn();
  const controller = new ChatController({
    endpoint: '/api/chat',
    lang: () => 'es',
    store,
    fetch,
    onMessage,
    onError,
  });
  return { controller, store, onMessage, onError };
}

const idle = (controller: ChatController) =>
  vi.waitFor(() => expect(controller.state.status).toBe('idle'));

describe('ChatController', () => {
  it('sends the history and commits the streamed reply', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      sse(reply('Hola, ', '**bienvenido**')),
    );
    const { controller, store, onMessage } = setup(fetch);

    expect(controller.send('  Hola  ')).toBe(true);
    // The typing state is set synchronously, before any network.
    expect(controller.state.status).toBe('waiting');
    await idle(controller);

    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({
      messages: [{ role: 'user', content: 'Hola' }],
      lang: 'es',
    });
    expect(controller.state.messages.map(textOf)).toEqual(['Hola', 'Hola, **bienvenido**']);
    expect(onMessage).toHaveBeenCalledOnce();
    expect(restoreMessages(store.load())).toEqual(controller.state.messages);
  });

  it('ignores empty messages and sends while busy', () => {
    const { controller } = setup(openStream().fetch);
    expect(controller.send('   ')).toBe(false);
    expect(controller.send('a')).toBe(true);
    expect(controller.send('b')).toBe(false);
  });

  it('streams into the draft, and replace swaps it', async () => {
    const stream = openStream();
    const { controller } = setup(stream.fetch);
    controller.send('Hola');
    stream.push(frame('delta', { text: 'Parcial' }));
    await vi.waitFor(() => expect(controller.state.draft).toBe('Parcial'));
    expect(controller.state.status).toBe('streaming');
    stream.push(frame('replace', { text: 'No puedo ayudar.' }));
    stream.push(frame('done', { finishReason: 'refusal' }));
    await idle(controller);
    expect(textOf(controller.state.messages[1]!)).toBe('No puedo ayudar.');
  });

  it('marks a reply cut off by max_tokens', async () => {
    const body = reply('Largo').replace('"stop"', '"max_tokens"');
    const { controller } = setup(async () => sse(body));
    controller.send('Hola');
    await idle(controller);
    expect(controller.state.messages[1]?.notice).toBe('cut_off');
  });

  it('stop keeps the partial reply with a notice', async () => {
    const stream = openStream();
    const { controller } = setup(stream.fetch);
    controller.send('Hola');
    stream.push(frame('delta', { text: 'Medio' }));
    await vi.waitFor(() => expect(controller.state.draft).toBe('Medio'));

    expect(controller.stop()).toBeUndefined();
    expect(controller.state.status).toBe('idle');
    expect(controller.state.messages[1]).toMatchObject({ role: 'assistant', notice: 'stopped' });
    // Late frames from the aborted request are ignored.
    expect(controller.state.messages).toHaveLength(2);
  });

  it('stop before any text takes the question back', () => {
    const { controller } = setup(openStream().fetch);
    controller.send('Hola');
    expect(controller.stop()).toBe('Hola');
    expect(controller.state.messages).toEqual([]);
  });

  it('shows errors and retries the same question', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        sse(frame('error', { code: 'unavailable', message: 'No disponible.' })),
      )
      .mockResolvedValueOnce(sse(reply('Ya.')));
    const { controller, onError } = setup(fetch);

    controller.send('Hola');
    await idle(controller);
    expect(controller.state.error).toEqual({ code: 'unavailable', message: 'No disponible.' });
    expect(onError).toHaveBeenCalledOnce();

    controller.retry();
    await idle(controller);
    expect(controller.state.error).toBeUndefined();
    expect(controller.state.messages.map(textOf)).toEqual(['Hola', 'Ya.']);
    expect(fetch.mock.calls[1]?.[1]?.body).toBe(fetch.mock.calls[0]?.[1]?.body);
  });

  it('replaces a question that failed when the visitor sends another', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(sse(reply('Ok')));
    const { controller } = setup(fetch);
    controller.send('Primera');
    await idle(controller);
    expect(controller.state.error?.code).toBe('network');

    controller.send('Segunda');
    await idle(controller);
    expect(controller.state.messages.map(textOf)).toEqual(['Segunda', 'Ok']);
  });

  it('treats a reply with no text as a failure', async () => {
    const { controller } = setup(async () => sse(reply()));
    controller.send('Hola');
    await idle(controller);
    expect(controller.state.error?.code).toBe('bad_response');
    expect(controller.state.messages).toHaveLength(1);
  });

  it('restores a saved conversation, offering Retry if it was interrupted', () => {
    const saved = { v: 1, messages: [createMessage('user', 'Hola')] };
    const { controller } = setup(openStream().fetch, memoryStore(saved));
    expect(controller.state.messages).toEqual(saved.messages);
    expect(controller.state.error?.code).toBe('network');
  });

  it('reset clears the conversation and its saved copy', async () => {
    const { controller, store } = setup(async () => sse(reply('Ok')));
    controller.send('Hola');
    await idle(controller);
    controller.reset();
    expect(controller.state.messages).toEqual([]);
    expect(store.load()).toBeUndefined();
  });
});

describe('restoreMessages', () => {
  it.each([undefined, null, 'x', { v: 2, messages: [] }, { v: 1, messages: [{ id: 1 }] }])(
    'ignores malformed data: %j',
    (value) => {
      expect(restoreMessages(value)).toEqual([]);
    },
  );
});
