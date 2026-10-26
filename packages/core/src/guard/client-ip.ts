/** Per-request details the framework knows but a web `Request` doesn't carry. */
export interface RequestContext {
  /** The visitor's IP, e.g. Astro's `clientAddress` or Node's `socket.remoteAddress`. */
  clientIp?: string;
}

/** Shared bucket for requests whose IP can't be determined. */
export const UNKNOWN_IP = 'unknown';

let warnedUnknown = false;

/**
 * The visitor's IP for rate limiting: the framework-provided address first,
 * then the proxy header the site said to trust. Proxies append to
 * `X-Forwarded-For`, so only its rightmost entry was written by the trusted
 * proxy; anything to the left came from the visitor and can be forged.
 */
export function resolveClientIp(
  request: Request,
  context: RequestContext = {},
  trustProxyHeader?: string,
): string {
  if (context.clientIp) return context.clientIp;
  if (trustProxyHeader) {
    const value = request.headers.get(trustProxyHeader);
    const ip = value?.split(',').at(-1)?.trim();
    if (ip) return ip;
  }
  if (!warnedUnknown) {
    warnedUnknown = true;
    console.warn(
      JSON.stringify({
        event: 'ai-chat.warning',
        message:
          'Client IP unknown: all visitors share one rate limit. Pass { clientIp } to the handler or set trustProxyHeader.',
      }),
    );
  }
  return UNKNOWN_IP;
}

/** Test hook: lets the one-time warning fire again. */
export function resetUnknownIpWarning(): void {
  warnedUnknown = false;
}
