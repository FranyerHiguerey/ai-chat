import { describe, expect, it } from 'vitest';
import { parseChatRequest } from './request.js';
import { testConfig } from '../test/helpers.js';

const config = testConfig({ limits: { maxMessageChars: 20, maxTurns: 2 } });
const user = (content = 'Hola') => ({ role: 'user', content });
const assistant = (content = '¿En qué te ayudo?') => ({ role: 'assistant', content });

describe('parseChatRequest', () => {
  it('accepts a valid conversation and keeps the language', () => {
    const body = { messages: [user(), assistant(), user('¿Envíos?')], lang: 'es' };
    expect(parseChatRequest(body, config)).toEqual({ ok: true, value: body });
  });

  it('falls back silently on unknown languages', () => {
    const result = parseChatRequest({ messages: [user()], lang: 'fr' }, config);
    expect(result).toEqual({ ok: true, value: { messages: [user()], lang: undefined } });
  });

  it.each([
    ['not an object', 'hello'],
    ['no messages', { messages: [] }],
    ['a bad role', { messages: [{ role: 'system', content: 'x' }] }],
    ['non-string content', { messages: [{ role: 'user', content: 42 }] }],
    ['an assistant first', { messages: [assistant(), user()] }],
    ['two users in a row', { messages: [user(), user()] }],
    ['an assistant last', { messages: [user(), assistant()] }],
    ['a blank message', { messages: [user('   ')] }],
  ])('rejects %s as invalid_request', (_name, body) => {
    expect(parseChatRequest(body, config)).toMatchObject({ ok: false, code: 'invalid_request' });
  });

  it('rejects messages over maxMessageChars, keeping lang for the error text', () => {
    const body = { messages: [user('x'.repeat(21))], lang: 'en' };
    expect(parseChatRequest(body, config)).toEqual({
      ok: false,
      code: 'message_too_long',
      lang: 'en',
    });
  });

  it('rejects conversations over maxTurns user turns', () => {
    const ok = { messages: [user(), assistant(), user()] };
    const tooLong = { messages: [user(), assistant(), user(), assistant(), user()] };
    expect(parseChatRequest(ok, config).ok).toBe(true);
    expect(parseChatRequest(tooLong, config)).toMatchObject({ ok: false, code: 'too_many_turns' });
  });
});
