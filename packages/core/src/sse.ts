import type { ServerEvent } from './protocol.js';

/**
 * Encodes one protocol event as an SSE frame. JSON.stringify escapes newlines,
 * so `data` always fits on a single line.
 */
export function encodeEvent(event: ServerEvent): string {
  const { type, ...data } = event;
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** An SSE comment, ignored by clients. Used as a heartbeat to keep proxies from timing out. */
export function encodeComment(text: string): string {
  return `: ${text}\n\n`;
}
