import type { StreamErrorCode } from './protocol.js';

export type ProviderErrorCode =
  'aborted' | 'rate_limited' | 'auth' | 'bad_request' | 'unavailable' | 'missing_sdk';

/** A provider failure in provider-neutral terms. The original SDK error is kept as `cause`. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProviderError';
    this.code = code;
  }
}

type ErrorClass = abstract new (...args: never[]) => Error;

/** The typed error classes both the Anthropic and OpenAI SDKs export under the same names. */
export interface SdkErrorClasses {
  APIError: ErrorClass;
  APIUserAbortError: ErrorClass;
  RateLimitError: ErrorClass;
  AuthenticationError: ErrorClass;
  PermissionDeniedError: ErrorClass;
  BadRequestError: ErrorClass;
}

/**
 * Maps an SDK error to a ProviderError, most specific class first. Abort
 * classes are subclasses of APIError, so they must be checked before it.
 * Anything that isn't an SDK error (a bug in our code) is returned unchanged.
 */
export function fromSdkError(
  error: unknown,
  sdk: SdkErrorClasses,
  signal?: AbortSignal | null,
): unknown {
  if (error instanceof ProviderError) return error;
  if (signal?.aborted || error instanceof sdk.APIUserAbortError) {
    return new ProviderError('aborted', 'Request aborted', { cause: error });
  }
  if (!(error instanceof Error)) return error;

  // A helper, so TypeScript doesn't narrow `error` to never after the first miss.
  const is = (cls: ErrorClass) => error instanceof cls;
  const map = (code: ProviderErrorCode) => new ProviderError(code, error.message, { cause: error });
  if (is(sdk.RateLimitError)) return map('rate_limited');
  if (is(sdk.AuthenticationError) || is(sdk.PermissionDeniedError)) return map('auth');
  if (is(sdk.BadRequestError)) return map('bad_request');
  // Connection errors, timeouts, 5xx and overloaded all land here.
  if (is(sdk.APIError)) return map('unavailable');
  return error;
}

/** What the browser is told. Auth and request-shape problems are our fault, not the visitor's. */
export function toStreamErrorCode(error: unknown): StreamErrorCode {
  if (error instanceof ProviderError) {
    if (error.code === 'rate_limited') return 'rate_limited';
    if (error.code === 'unavailable') return 'unavailable';
  }
  return 'internal';
}
