import { z } from 'zod';
import { LANGUAGES, type ChatConfig, type Language } from './config.js';
import type { RequestErrorCode } from './protocol.js';
import type { ChatMessage } from './types.js';

const bodySchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).min(1),
  // Unknown languages fall back to the site default instead of failing.
  lang: z.enum(LANGUAGES).optional().catch(undefined),
});

export interface ParsedChatRequest {
  messages: ChatMessage[];
  lang?: Language;
}

export type ParseResult =
  { ok: true; value: ParsedChatRequest } | { ok: false; code: RequestErrorCode; lang?: Language };

/**
 * Validates a chat request body against the site's limits. Cheap checks only:
 * this runs before any model call, so rejected requests cost nothing.
 */
export function parseChatRequest(body: unknown, config: ChatConfig): ParseResult {
  const result = bodySchema.safeParse(body);
  if (!result.success) return { ok: false, code: 'invalid_request' };

  const { messages, lang } = result.data;
  const fail = (code: RequestErrorCode): ParseResult => ({ ok: false, code, lang });

  // user, assistant, user, ... ending with the visitor's new message.
  const alternates = messages.every((m, i) => m.role === (i % 2 === 0 ? 'user' : 'assistant'));
  if (!alternates || messages.length % 2 === 0) return fail('invalid_request');
  if (messages.some((m) => m.content.trim() === '')) return fail('invalid_request');
  if (messages.some((m) => m.content.length > config.limits.maxMessageChars)) {
    return fail('message_too_long');
  }
  const total = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (total > config.limits.maxConversationChars) return fail('message_too_long');
  if ((messages.length + 1) / 2 > config.limits.maxTurns) return fail('too_many_turns');

  return { ok: true, value: { messages, lang } };
}
