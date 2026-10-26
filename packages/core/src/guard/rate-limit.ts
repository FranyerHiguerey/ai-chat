import type { GuardStore } from './store.js';

export interface RateLimitOptions {
  store: GuardStore;
  /** Requests per minute from one IP. */
  rpmPerIp: number;
  /** Requests per minute from everyone together: a ceiling that holds even if IPs are forged. */
  rpmGlobal: number;
  /** Replies one IP may stream at the same time. Counted per process. */
  maxConcurrentPerIp: number;
}

export type RateLimitResult =
  | { ok: true; /** Call once the reply ends. */ release: () => void }
  | { ok: false; retryAfterSec: number };

const WINDOW_MS = 60_000;

/**
 * Fixed one-minute windows. Every request counts, valid or not, so a flood of
 * cheap malformed requests is limited too.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const { store, rpmPerIp, rpmGlobal, maxConcurrentPerIp } = options;
  const active = new Map<string, number>();

  async function check(ip: string): Promise<RateLimitResult> {
    const now = Date.now();
    const window = Math.floor(now / WINDOW_MS);
    const retryAfterSec = Math.max(1, Math.ceil(((window + 1) * WINDOW_MS - now) / 1000));

    const [global, perIp] = await Promise.all([
      store.incr(`rl:all:${window}`, 1, WINDOW_MS),
      store.incr(`rl:ip:${ip}:${window}`, 1, WINDOW_MS),
    ]);
    if (global > rpmGlobal || perIp > rpmPerIp) return { ok: false, retryAfterSec };

    const streams = active.get(ip) ?? 0;
    if (streams >= maxConcurrentPerIp) return { ok: false, retryAfterSec: 1 };
    active.set(ip, streams + 1);

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const left = (active.get(ip) ?? 1) - 1;
      if (left > 0) active.set(ip, left);
      else active.delete(ip);
    };
    return { ok: true, release };
  }

  return { check };
}
