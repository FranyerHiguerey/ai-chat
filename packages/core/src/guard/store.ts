/**
 * Counter storage for rate limits and the daily budget. The in-memory default
 * is per process: serverless and multi-instance deploys should pass a shared
 * store (Redis, Upstash, a database) so every instance sees the same counts.
 */
export interface GuardStore {
  /** Adds `amount` to `key` and returns the new total. A new key expires after `ttlMs`. */
  incr(key: string, amount: number, ttlMs: number): Promise<number>;
}

/** A Map-backed store. Expired keys are swept on write, so it never grows unbounded. */
export function memoryStore(): GuardStore {
  const counters = new Map<string, { value: number; expiresAt: number }>();
  let nextSweep = 0;

  const sweep = (now: number) => {
    if (now < nextSweep) return;
    nextSweep = now + 60_000;
    for (const [key, entry] of counters) {
      if (entry.expiresAt <= now) counters.delete(key);
    }
  };

  return {
    async incr(key, amount, ttlMs) {
      const now = Date.now();
      sweep(now);
      const entry = counters.get(key);
      if (!entry || entry.expiresAt <= now) {
        counters.set(key, { value: amount, expiresAt: now + ttlMs });
        return amount;
      }
      entry.value += amount;
      return entry.value;
    },
  };
}
