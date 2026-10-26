/**
 * The wire protocol between the server handler and browser clients.
 * Type-only (plus one constant) so browser packages can depend on it without
 * pulling in any server code. Documented in docs/protocol.md.
 */
import type { Language } from './config.js';
import type { ChatMessage, FinishReason } from './types.js';

export type { ChatMessage, FinishReason, Language };

export const PROTOCOL_VERSION = 1;

/** Error codes sent in an `error` event once the stream is open. */
export type StreamErrorCode = 'rate_limited' | 'unavailable' | 'internal';

/** Error codes sent as a JSON response before any stream opens. */
export type RequestErrorCode =
  'invalid_request' | 'message_too_long' | 'too_many_turns' | 'method_not_allowed';

export interface ChatRequestBody {
  messages: ChatMessage[];
  /** UI language; fixed replies and error messages follow it. */
  lang?: Language;
}

export interface RequestErrorBody {
  error: { code: RequestErrorCode; message: string };
}

export interface ServerEventMap {
  /** Sent immediately so the UI can show a typing indicator. */
  start: { id: string; protocol: number };
  /** A piece of the reply, as raw markdown. */
  delta: { text: string };
  /** Discard everything streamed so far and show this text instead (e.g. after a refusal). */
  replace: { text: string };
  done: { finishReason: FinishReason };
  /** `message` is already localized and safe to show. */
  error: { code: StreamErrorCode; message: string };
}

export type ServerEventType = keyof ServerEventMap;

export type ServerEvent = {
  [K in ServerEventType]: { type: K } & ServerEventMap[K];
}[ServerEventType];

export const SERVER_EVENT_TYPES: readonly ServerEventType[] = [
  'start',
  'delta',
  'replace',
  'done',
  'error',
];
