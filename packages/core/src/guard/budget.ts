import type { UsageReport } from '../types.js';
import type { GuardStore } from './store.js';

const DAY_MS = 86_400_000;

/**
 * A provider-neutral cost estimate in "input token" units: cache reads bill at
 * about a tenth of normal input on both providers, everything else counts in full.
 */
export function weightedTokens(usage: UsageReport): number {
  return (
    usage.inputTokens +
    usage.cacheCreationInputTokens +
    usage.outputTokens +
    usage.cacheReadInputTokens * 0.1
  );
}

export interface BudgetOptions {
  store: GuardStore;
  /** Weighted tokens allowed per UTC day across all visitors. 0 turns the cap off. */
  dailyTokenBudget: number;
}

/** A daily spend ceiling. New chats are refused once the day's total reaches it. */
export function createBudget({ store, dailyTokenBudget }: BudgetOptions) {
  const key = () => `budget:${new Date().toISOString().slice(0, 10)}`;
  /** Weighted tokens spent today. */
  const spent = () => store.incr(key(), 0, DAY_MS);

  return {
    enabled: dailyTokenBudget > 0,
    spent,
    exhausted: async () => dailyTokenBudget > 0 && (await spent()) >= dailyTokenBudget,
    /** Adds a finished request's usage and returns the day's new total. */
    add: (usage: UsageReport) => store.incr(key(), weightedTokens(usage), DAY_MS),
  };
}
