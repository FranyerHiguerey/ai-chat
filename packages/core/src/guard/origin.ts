export type OriginCheck =
  { ok: false } | { ok: true; /** Set for allowed cross-origin requests. */ corsOrigin?: string };

function normalize(origin: string): string | undefined {
  try {
    return new URL(origin).origin;
  } catch {
    return undefined;
  }
}

/**
 * Decides whether a browser on `Origin` may use the endpoint. With no
 * `allowedOrigins`, only the endpoint's own origin is accepted.
 *
 * A request without `Origin` is not a browser fetch (browsers always send it on
 * POST), so it can't be another site embedding the bot; it is let through and
 * left to the rate limits. This check stops embedding, not scripts.
 */
export function checkOrigin(request: Request, allowedOrigins: readonly string[]): OriginCheck {
  const header = request.headers.get('origin');
  if (header === null) return { ok: true };

  const origin = normalize(header);
  if (!origin) return { ok: false };
  if (allowedOrigins.length === 0) {
    return origin === new URL(request.url).origin ? { ok: true } : { ok: false };
  }
  const allowed = allowedOrigins.some((entry) => normalize(entry) === origin);
  if (!allowed) return { ok: false };
  return origin === new URL(request.url).origin ? { ok: true } : { ok: true, corsOrigin: origin };
}

/** Headers for an allowed cross-origin response, preflight included. */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
