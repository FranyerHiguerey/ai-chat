import { createBuilder, type Build } from './build.js';
import type { ChatClientOptions } from './client.js';
import { ProviderError, toStreamErrorCode } from './errors.js';
import { createBudget, weightedTokens } from './guard/budget.js';
import { readJsonBody } from './guard/body.js';
import { resolveClientIp, type RequestContext } from './guard/client-ip.js';
import { defaultLogger, hashIp, type Logger, type RequestLogEntry } from './guard/log.js';
import { checkOrigin, corsHeaders } from './guard/origin.js';
import { createRateLimiter } from './guard/rate-limit.js';
import { memoryStore, type GuardStore } from './guard/store.js';
import { stringsFor } from './i18n.js';
import { PROTOCOL_VERSION, type RequestErrorBody, type RequestErrorCode } from './protocol.js';
import { parseChatRequest } from './request.js';
import { encodeComment, encodeEvent } from './sse.js';
import type { ChatSource } from './source.js';
import type { ChatMessage, UsageReport } from './types.js';

export interface ChatHandlerOptions extends ChatClientOptions {
  /** Interval between SSE heartbeat comments. Default 15s. */
  heartbeatMs?: number;
  /**
   * Where rate-limit and budget counters live. Defaults to memory, which is
   * per process: pass a shared store on serverless or multi-instance deploys.
   */
  store?: GuardStore;
  /**
   * A header set by your proxy or host that carries the visitor's IP, used
   * when the framework doesn't pass `clientIp`. Only set this behind a proxy
   * that overwrites it, e.g. `x-forwarded-for` or `cf-connecting-ip`.
   */
  trustProxyHeader?: string;
  /** Receives one entry per request and per failure. Defaults to JSON lines on the console. */
  logger?: Logger;
  /**
   * Content from a dashboard or CMS. Its settings override `company`,
   * `languages` and `widget`; `config` still sets everything else.
   */
  source?: ChatSource;
}

export type ChatHandler = (request: Request, context?: RequestContext) => Promise<Response>;

export type { RequestContext };

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
 *
 * Checks run cheapest first and all happen before the model is called, so a
 * rejected request costs nothing: method, origin, rate limits, body size,
 * request shape, then the daily budget.
 *
 * `GET` returns the public widget settings (`{ protocol, widget }`) so a
 * widget with `remote-config` picks up dashboard edits without new markup.
 */
export function createChatHandler(options: ChatHandlerOptions): ChatHandler {
  const { config, heartbeatMs = 15_000, trustProxyHeader, logger = defaultLogger } = options;
  const { limits } = config;
  const store = options.store ?? memoryStore();
  const limiter = createRateLimiter({ store, ...limits });
  const budget = createBudget({ store, dailyTokenBudget: limits.dailyTokenBudget });

  const logError = (stage: string, error: unknown) => {
    const details =
      error instanceof ProviderError
        ? { code: error.code, message: error.message }
        : { message: error instanceof Error ? error.message : String(error) };
    logger({ event: 'ai-chat.error', stage, ...details });
  };

  // The request log carries usage, so the client's default usage line is turned off.
  const builder = createBuilder({
    ...options,
    onUsage: options.onUsage ?? (() => {}),
    onStale: (error) => logError('source', error),
  });

  return async (request, context) => {
    const startedAt = Date.now();
    const id = crypto.randomUUID();
    const origin = checkOrigin(request, config.allowedOrigins);
    const cors = origin.ok && origin.corsOrigin ? corsHeaders(origin.corsOrigin) : {};

    if (request.method === 'OPTIONS') {
      return origin.ok
        ? new Response(null, { status: 204, headers: { Allow: 'GET, POST', ...cors } })
        : requestError(403, 'forbidden_origin');
    }

    const ip = resolveClientIp(request, context, trustProxyHeader);
    const entry: RequestLogEntry = {
      event: 'ai-chat.request',
      id,
      outcome: 'rejected',
      status: 0,
      code: null,
      durationMs: 0,
      ip: hashIp(ip),
      origin: request.headers.get('origin'),
      lang: null,
      finishReason: null,
      usage: null,
      weightedTokens: null,
      budgetUsedToday: null,
    };
    const log = (changes: Partial<RequestLogEntry>) => {
      logger({ ...entry, ...changes, durationMs: Date.now() - startedAt });
    };

    function requestError(
      status: number,
      code: RequestErrorCode,
      lang?: string,
      headers: Record<string, string> = {},
    ) {
      const body: RequestErrorBody = {
        error: { code, message: stringsFor(lang, builder.config).requestErrors[code] },
      };
      return Response.json(body, { status, headers: { ...headers, ...cors } });
    }

    const reject = (
      status: number,
      code: RequestErrorCode,
      lang?: string,
      headers?: Record<string, string>,
    ) => {
      log({ status, code, lang: lang ?? null });
      return requestError(status, code, lang, headers);
    };

    if (request.method === 'GET') {
      if (!origin.ok) return requestError(403, 'forbidden_origin');
      return publicSettings(cors);
    }
    if (request.method !== 'POST') {
      return reject(405, 'method_not_allowed', undefined, { Allow: 'GET, POST' });
    }
    if (!origin.ok) return reject(403, 'forbidden_origin');

    const slot = await limiter.check(ip);
    if (!slot.ok) {
      return reject(429, 'rate_limited', undefined, { 'Retry-After': String(slot.retryAfterSec) });
    }

    // The slot is freed when the reply ends; until the stream takes it over,
    // every early return must free it here.
    let streaming = false;
    try {
      const body = await readJsonBody(request, limits.maxBodyBytes);
      if (!body.ok) {
        return body.reason === 'too_large'
          ? reject(413, 'message_too_long')
          : reject(400, 'invalid_request');
      }
      const parsed = parseChatRequest(body.value, builder.config);
      if (!parsed.ok) return reject(400, parsed.code, parsed.lang);
      const { messages, lang } = parsed.value;
      entry.lang = lang ?? null;

      if (await budget.exhausted()) {
        logger({ event: 'ai-chat.error', stage: 'budget', message: 'Daily token budget reached' });
        return reject(503, 'unavailable', lang);
      }

      let build: Build;
      try {
        build = await builder.current();
      } catch (error) {
        logError('setup', error);
        log({ outcome: 'error', status: 500, code: 'internal' });
        return Response.json(
          {
            error: {
              code: 'internal',
              message: stringsFor(lang, builder.config).streamErrors.internal,
            },
          },
          { status: 500, headers: cors },
        );
      }

      streaming = true;
      return streamReply({ request, build, messages, lang, id, cors, release: slot.release, log });
    } finally {
      if (!streaming) slot.release();
    }
  };

  /** The widget settings anyone may read. Cheap: no model call, so it isn't rate limited. */
  async function publicSettings(cors: Record<string, string>): Promise<Response> {
    let config = builder.config;
    try {
      config = (await builder.current()).config;
    } catch (error) {
      logError('setup', error);
    }
    return Response.json(
      { protocol: PROTOCOL_VERSION, widget: config.widget },
      { headers: { 'Cache-Control': 'public, max-age=60', ...cors } },
    );
  }

  function streamReply(reply: {
    request: Request;
    build: Build;
    messages: ChatMessage[];
    lang?: string;
    id: string;
    cors: Record<string, string>;
    release: () => void;
    log: (changes: Partial<RequestLogEntry>) => void;
  }): Response {
    const { request, build, messages, lang, id, release, log } = reply;
    const { chat } = build;
    const strings = stringsFor(lang, build.config);

    // One controller for both ways a visitor can leave: the request is aborted
    // (closed tab, network drop) or the response stream is cancelled (Stop).
    const abort = new AbortController();
    const onRequestAbort = () => abort.abort();
    request.signal.addEventListener('abort', onRequestAbort, { once: true });

    const encoder = new TextEncoder();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    let pendingUsage: Promise<Partial<RequestLogEntry>> = Promise.resolve({});

    const cleanup = () => {
      clearInterval(heartbeat);
      request.signal.removeEventListener('abort', onRequestAbort);
      release();
    };

    const onUsage = (usage: UsageReport) => {
      pendingUsage = budget.add(usage).then((budgetUsedToday) => ({
        usage,
        weightedTokens: weightedTokens(usage),
        budgetUsedToday,
      }));
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (chunk: string) => {
          if (!closed) controller.enqueue(encoder.encode(chunk));
        };

        send(encodeEvent({ type: 'start', id, protocol: PROTOCOL_VERSION }));
        heartbeat = setInterval(() => send(encodeComment('ping')), heartbeatMs);

        // Not awaited: start() must return so the first bytes flush right away.
        void (async () => {
          let result: Partial<RequestLogEntry> = { outcome: 'ok', status: 200 };
          try {
            for await (const event of chat.stream(messages, {
              lang,
              signal: abort.signal,
              onUsage,
            })) {
              send(encodeEvent(event));
              if (event.type === 'done') result.finishReason = event.finishReason;
            }
          } catch (error) {
            if (abort.signal.aborted) {
              result = { outcome: 'aborted', status: 200 };
            } else {
              logError('stream', error);
              const code = toStreamErrorCode(error);
              send(encodeEvent({ type: 'error', code, message: strings.streamErrors[code] }));
              result = { outcome: 'error', status: 200, code };
            }
          } finally {
            cleanup();
            if (!closed) {
              closed = true;
              controller.close();
            }
            log({ ...result, ...(await pendingUsage.catch(() => ({}))) });
          }
        })();
      },
      cancel() {
        closed = true;
        abort.abort();
        cleanup();
      },
    });

    return new Response(stream, { headers: { ...SSE_HEADERS, ...reply.cors } });
  }
}
