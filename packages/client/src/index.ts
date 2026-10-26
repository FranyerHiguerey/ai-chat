import type {
  Card,
  CardItem,
  ChatMessage,
  HandoffChannel,
  Language,
  LeadFields,
  LeadRequestBody,
  RequestErrorBody,
  RequestErrorCode,
  ServerEvent,
  StreamErrorCode,
} from '@franyerhiguerey/ai-chat-core/protocol';
import { parseSSE } from './sse.js';

export { parseSSE, type SSEMessage } from './sse.js';
export type {
  Card,
  CardItem,
  ChatMessage,
  HandoffChannel,
  Language,
  LeadFields,
  ServerEvent,
  StreamErrorCode,
  RequestErrorCode,
};

/** Failures detected in the browser rather than reported by the server. */
export type ClientErrorCode = 'network' | 'bad_response';

export type ErrorCode = StreamErrorCode | RequestErrorCode | ClientErrorCode;

/**
 * Every event `streamChat` yields. Errors from any source arrive as one `error`
 * event, so a UI handles them in one place. Its `message` is already localized
 * when it came from the server; for client errors, localize by `code`.
 */
export type ChatEvent =
  Exclude<ServerEvent, { type: 'error' }> | { type: 'error'; code: ErrorCode; message: string };

export interface StreamChatOptions {
  /** URL of the site's ai-chat endpoint, e.g. `/api/chat`. */
  endpoint: string;
  messages: ChatMessage[];
  lang?: Language;
  /** Abort to stop the reply (a Stop button). The generator then just ends. */
  signal?: AbortSignal;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Override fetch (tests, custom transports). */
  fetch?: typeof fetch;
}

const KNOWN_EVENTS = new Set<string>([
  'start',
  'delta',
  'replace',
  'suggestions',
  'card',
  'done',
  'error',
]);

/**
 * Sends a conversation to an ai-chat endpoint and yields its events as they
 * arrive. Unknown events are skipped, so newer servers don't break older clients.
 */
export async function* streamChat(options: StreamChatOptions): AsyncGenerator<ChatEvent> {
  const { endpoint, messages, lang, signal, headers, fetch: doFetch = fetch } = options;

  let response: Response;
  try {
    response = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...headers },
      body: JSON.stringify({ messages, lang }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) return;
    yield { type: 'error', code: 'network', message: errorMessage(error) };
    return;
  }

  if (!response.ok) {
    yield await requestError(response);
    return;
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    yield { type: 'error', code: 'bad_response', message: 'Expected an event stream' };
    return;
  }

  let finished = false;
  try {
    for await (const { event, data } of parseSSE(response.body)) {
      if (!KNOWN_EVENTS.has(event)) continue;
      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      const chatEvent = { ...(payload as object), type: event } as ChatEvent;
      yield chatEvent;
      if (event === 'done' || event === 'error') finished = true;
    }
  } catch (error) {
    if (signal?.aborted) return;
    yield { type: 'error', code: 'network', message: errorMessage(error) };
    return;
  }

  // The connection closed without `done` or `error`: the reply is incomplete.
  if (!finished && !signal?.aborted) {
    yield {
      type: 'error',
      code: 'network',
      message: 'The connection closed before the reply ended',
    };
  }
}

export interface SubmitLeadOptions extends LeadRequestBody {
  /** The same endpoint the chat uses. */
  endpoint: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export type SubmitLeadResult = { ok: true } | { ok: false; code: ErrorCode; message: string };

/** Sends the lead form to the site's endpoint, which forwards it to the site's webhook. */
export async function submitLead(options: SubmitLeadOptions): Promise<SubmitLeadResult> {
  const { endpoint, headers, fetch: doFetch = fetch, ...body } = options;
  let response: Response;
  try {
    response = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, code: 'network', message: errorMessage(error) };
  }
  if (response.ok) return { ok: true };
  const failure = await requestError(response);
  return failure.type === 'error'
    ? { ok: false, code: failure.code, message: failure.message }
    : { ok: false, code: 'bad_response', message: `HTTP ${response.status}` };
}

async function requestError(response: Response): Promise<ChatEvent> {
  try {
    const body = (await response.json()) as Partial<RequestErrorBody>;
    if (body.error?.code && body.error.message) {
      return { type: 'error', code: body.error.code, message: body.error.message };
    }
  } catch {
    // Not JSON: fall through.
  }
  return { type: 'error', code: 'bad_response', message: `HTTP ${response.status}` };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
