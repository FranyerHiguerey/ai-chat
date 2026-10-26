import { createHash, randomBytes } from 'node:crypto';
import type { UsageReport } from '../types.js';

/** One line per chat request. Never includes message text, raw IPs or secrets. */
export interface RequestLogEntry {
  event: 'ai-chat.request';
  id: string;
  outcome: 'ok' | 'aborted' | 'error' | 'rejected';
  status: number;
  /** The error code sent to the browser, if any. */
  code: string | null;
  durationMs: number;
  /** A salted hash: lets you spot one noisy visitor without storing their address. */
  ip: string;
  origin: string | null;
  lang: string | null;
  finishReason: string | null;
  usage: UsageReport | null;
  weightedTokens: number | null;
  /** Weighted tokens spent today across all visitors, after this request. */
  budgetUsedToday: number | null;
}

/** A failure the site owner may need to act on. */
export interface ErrorLogEntry {
  event: 'ai-chat.error';
  stage: string;
  code?: string;
  message: string;
}

export type LogEntry = RequestLogEntry | ErrorLogEntry;

export type Logger = (entry: LogEntry) => void;

/** One JSON line per entry on the console. Errors on `error`/`warn`, requests on `info`. */
export const defaultLogger: Logger = (entry) => {
  const level =
    entry.event === 'ai-chat.request'
      ? 'info'
      : entry.code === 'auth' || !entry.code
        ? 'error'
        : 'warn';
  console[level](JSON.stringify(entry));
};

// New per process, so hashes can't be matched across restarts or reversed by brute force offline.
const salt = randomBytes(16);

export function hashIp(ip: string): string {
  return createHash('sha256').update(salt).update(ip).digest('hex').slice(0, 12);
}
