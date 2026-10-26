import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { USAGE } from '../../test/helpers.js';
import { createBudget, weightedTokens } from './budget.js';
import { memoryStore } from './store.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T23:59:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('weightedTokens', () => {
  it('counts cache reads at a tenth', () => {
    // 12 input + 0 cache writes + 5 output + 900 cache reads × 0.1
    expect(weightedTokens(USAGE)).toBe(107);
  });
});

describe('createBudget', () => {
  it('is exhausted once the day reaches the budget', async () => {
    const budget = createBudget({ store: memoryStore(), dailyTokenBudget: 200 });
    expect(await budget.exhausted()).toBe(false);
    expect(await budget.add(USAGE)).toBe(107);
    expect(await budget.exhausted()).toBe(false);
    await budget.add(USAGE);
    expect(await budget.exhausted()).toBe(true);
  });

  it('starts over on the next UTC day', async () => {
    const budget = createBudget({ store: memoryStore(), dailyTokenBudget: 100 });
    await budget.add(USAGE);
    expect(await budget.exhausted()).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(await budget.exhausted()).toBe(false);
  });

  it('never runs out when the budget is 0', async () => {
    const budget = createBudget({ store: memoryStore(), dailyTokenBudget: 0 });
    await budget.add(USAGE);
    expect(budget.enabled).toBe(false);
    expect(await budget.exhausted()).toBe(false);
  });
});
