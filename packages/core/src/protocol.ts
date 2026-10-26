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
  | 'invalid_request'
  | 'message_too_long'
  | 'too_many_turns'
  | 'method_not_allowed'
  | 'forbidden_origin'
  | 'rate_limited'
  | 'unavailable'
  | 'lead_failed';

export interface ChatRequestBody {
  messages: ChatMessage[];
  /** UI language; fixed replies and error messages follow it. */
  lang?: Language;
}

/** A way to reach a person, built by the server from the site's config. */
export interface HandoffChannel {
  type: 'whatsapp' | 'email';
  /** A `https://wa.me/…` or `mailto:` link, with the conversation summary prefilled. */
  href: string;
}

/** Rich content shown under a reply. */
export type Card =
  | { kind: 'handoff'; channels: HandoffChannel[] }
  | { kind: 'lead_form'; /** Why the form is shown, in the visitor's language. */ reason: string };

/** What the visitor typed into the lead form. */
export interface LeadFields {
  name: string;
  email?: string;
  phone?: string;
  message?: string;
}

/** `POST` to the chat endpoint to send a lead. Told apart from a chat request by `lead`. */
export interface LeadRequestBody {
  lead: LeadFields;
  /** The conversation so far, so the team has context. */
  transcript?: ChatMessage[];
  /** The page the visitor was on. */
  page?: string;
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
  /** Reply chips: short follow-up questions the visitor can tap to send. */
  suggestions: { items: string[] };
  /** Rich content under the reply; `kind` says which. */
  card: Card;
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
  'suggestions',
  'card',
  'done',
  'error',
];
