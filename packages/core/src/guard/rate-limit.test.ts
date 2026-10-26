import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter, type RateLimitOptions } from './rate-limit.js';
import { memoryStore } from './store.js';

const limiter = (options: Partial<RateLimitOptions> = {}) =>
  createRateLimiter({
    store: memoryStore(),
    rpmPerIp: 2,
    rpmGlobal: 100,
    maxConcurrentPerIp: 10,
    ...options,
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T12:00:15Z'));
});
afterEach(() => vi.useRealTimers());

describe('createRateLimiter', () => {
  it('limits requests per IP per minute and says when to come back', async () => {
    const { check } = limiter();
    expect((await check('1.1.1.1')).ok).toBe(true);
    expect((await check('1.1.1.1')).ok).toBe(true);
    expect(await check('1.1.1.1')).toEqual({ ok: false, retryAfterSec: 45 });
    expect((await check('2.2.2.2')).ok).toBe(true);
  });

  it('opens again in the next window', async () => {
    const { check } = limiter({ rpmPerIp: 1 });
    await check('1.1.1.1');
    expect((await check('1.1.1.1')).ok).toBe(false);
    vi.advanceTimersByTime(45_000);
    expect((await check('1.1.1.1')).ok).toBe(true);
  });

  it('applies the global ceiling across IPs', async () => {
    const { check } = limiter({ rpmGlobal: 2 });
    await check('1.1.1.1');
    await check('2.2.2.2');
    expect((await check('3.3.3.3')).ok).toBe(false);
  });

  it('limits concurrent replies until a slot is released', async () => {
    const { check } = limiter({ rpmPerIp: 10, maxConcurrentPerIp: 1 });
    const first = await check('1.1.1.1');
    expect(await check('1.1.1.1')).toEqual({ ok: false, retryAfterSec: 1 });
    if (first.ok) {
      first.release();
      first.release(); // idempotent
    }
    expect((await check('1.1.1.1')).ok).toBe(true);
  });
});
