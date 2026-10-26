import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStore } from './store.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('memoryStore', () => {
  it('adds to a key and returns the running total', async () => {
    const store = memoryStore();
    expect(await store.incr('a', 1, 1000)).toBe(1);
    expect(await store.incr('a', 2.5, 1000)).toBe(3.5);
    expect(await store.incr('b', 1, 1000)).toBe(1);
  });

  it('starts a key over once it expires', async () => {
    const store = memoryStore();
    await store.incr('a', 5, 1000);
    vi.advanceTimersByTime(1000);
    expect(await store.incr('a', 1, 1000)).toBe(1);
  });
});
