import { createChatClient, type ChatClient, type ChatClientOptions } from './client.js';
import { ProviderError, toStreamErrorCode } from './errors.js';
import { stringsFor } from './i18n.js';
import { PROTOCOL_VERSION, type RequestErrorBody, type RequestErrorCode } from './protocol.js';
import { parseChatRequest } from './request.js';
import { encodeComment, encodeEvent } from './sse.js';

export interface ChatHandlerOptions extends ChatClientOptions {
  /** Interval between SSE heartbeat comments. Default 15s. */
  heartbeatMs?: number;
}

export type ChatHandler = (request: Request) => Promise<Response>;

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  // no-transform stops proxies from compressing (and so buffering) the stream.
  'Cache-Control': 'no-cache, no-transform',
  // Turns off response buffering in nginx and similar proxies.
  'X-Accel-Buffering': 'no',
};

/**
 * A web-standard `Request => Response` chat endpoint. Works as-is in Astro and
 * Next.js routes, serverless functions and Hono; Express needs the adapter.
 */
export function createChatHandler(options: ChatHandlerOptions): ChatHandler {
  const { config, heartbeatMs = 15_000 } = options;

  // Built on the first request and reused, so the knowledge is read once.
  let clientPromise: Promise<ChatClient> | undefined;
  const getClient = () => {
    clientPromise ??= createChatClient(options).catch((error: unknown) => {
      clientPromise = undefined; // let the next request retry after a fix
      throw error;
    });
    return clientPromise;
  };

  const requestError = (status: number, code: RequestErrorCode, lang?: string, headers = {}) => {
    const body: RequestErrorBody = {
      error: { code, message: stringsFor(lang, config).requestErrors[code] },
    };
    return Response.json(body, { status, headers });
  };

  return async (request) => {
    if (request.method !== 'POST') {
      return requestError(405, 'method_not_allowed', undefined, { Allow: 'POST' });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return requestError(400, 'invalid_request');
    }
    const parsed = parseChatRequest(body, config);
    if (!parsed.ok) return requestError(400, parsed.code, parsed.lang);
    const { messages, lang } = parsed.value;
    const strings = stringsFor(lang, config);

    let chat: ChatClient;
    try {
      chat = await getClient();
    } catch (error) {
      logError('setup', error);
      return Response.json(
        { error: { code: 'internal', message: strings.streamErrors.internal } },
        { status: 500 },
      );
    }

    // One controller for both ways a visitor can leave: the request is aborted
    // (closed tab, network drop) or the response stream is cancelled (Stop).
    const abort = new AbortController();
    const onRequestAbort = () => abort.abort();
    request.signal.addEventListener('abort', onRequestAbort, { once: true });

    const encoder = new TextEncoder();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let closed = false;

    const cleanup = () => {
      clearInterval(heartbeat);
      request.signal.removeEventListener('abort', onRequestAbort);
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (chunk: string) => {
          if (!closed) controller.enqueue(encoder.encode(chunk));
        };

        send(encodeEvent({ type: 'start', id: crypto.randomUUID(), protocol: PROTOCOL_VERSION }));
        heartbeat = setInterval(() => send(encodeComment('ping')), heartbeatMs);

        // Not awaited: start() must return so the first bytes flush right away.
        void (async () => {
          try {
            for await (const event of chat.stream(messages, { lang, signal: abort.signal })) {
              send(encodeEvent(event));
            }
          } catch (error) {
            if (abort.signal.aborted) {
              console.info(JSON.stringify({ event: 'ai-chat.aborted' }));
            } else {
              logError('stream', error);
              const code = toStreamErrorCode(error);
              send(encodeEvent({ type: 'error', code, message: strings.streamErrors[code] }));
            }
          } finally {
            cleanup();
            if (!closed) {
              closed = true;
              controller.close();
            }
          }
        })();
      },
      cancel() {
        closed = true;
        abort.abort();
        cleanup();
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  };
}

/** Logs failures for the site owner. Never includes visitor messages or secrets. */
function logError(stage: string, error: unknown): void {
  const details =
    error instanceof ProviderError
      ? { code: error.code, message: error.message }
      : { message: error instanceof Error ? error.message : String(error) };
  // auth means a wrong or revoked API key: something the site owner must fix.
  const level = error instanceof ProviderError && error.code !== 'auth' ? 'warn' : 'error';
  console[level](JSON.stringify({ event: 'ai-chat.error', stage, ...details }));
}
