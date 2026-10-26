import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { fromSdkError, ProviderError, toStreamErrorCode } from './errors.js';

const headers = new Headers();

describe.each([
  ['anthropic', Anthropic],
  ['openai', OpenAI],
] as const)('fromSdkError (%s)', (_name, Sdk) => {
  it.each([
    ['abort', () => new Sdk.APIUserAbortError(), 'aborted'],
    ['429', () => new Sdk.RateLimitError(429, undefined, 'slow down', headers), 'rate_limited'],
    ['401', () => new Sdk.AuthenticationError(401, undefined, 'bad key', headers), 'auth'],
    ['403', () => new Sdk.PermissionDeniedError(403, undefined, 'no', headers), 'auth'],
    ['400', () => new Sdk.BadRequestError(400, undefined, 'bad', headers), 'bad_request'],
    ['500', () => new Sdk.InternalServerError(500, undefined, 'boom', headers), 'unavailable'],
    ['network', () => new Sdk.APIConnectionError({ message: 'down' }), 'unavailable'],
  ] as const)('maps %s to %s', (_label, make, code) => {
    const original = make();
    const mapped = fromSdkError(original, Sdk);
    expect(mapped).toBeInstanceOf(ProviderError);
    expect(mapped).toMatchObject({ code, cause: original });
  });

  it('treats anything as aborted once the signal has fired', () => {
    const controller = new AbortController();
    controller.abort();
    expect(fromSdkError(new Error('socket closed'), Sdk, controller.signal)).toMatchObject({
      code: 'aborted',
    });
  });

  it('leaves non-SDK errors alone', () => {
    const bug = new TypeError('x is undefined');
    expect(fromSdkError(bug, Sdk)).toBe(bug);
  });
});

describe('toStreamErrorCode', () => {
  it('only exposes rate_limited and unavailable', () => {
    expect(toStreamErrorCode(new ProviderError('rate_limited', ''))).toBe('rate_limited');
    expect(toStreamErrorCode(new ProviderError('unavailable', ''))).toBe('unavailable');
    expect(toStreamErrorCode(new ProviderError('auth', ''))).toBe('internal');
    expect(toStreamErrorCode(new Error('bug'))).toBe('internal');
  });
});
