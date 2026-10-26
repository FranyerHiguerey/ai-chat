import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { LANGUAGES, type Language } from './config.js';
import type { LeadFields } from './protocol.js';
import type { ChatMessage } from './types.js';

/** Empty form fields arrive as "": treat them as not given. */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  );

const leadSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: optional(z.string().trim().email().max(200)),
    phone: optional(
      z
        .string()
        .trim()
        .max(40)
        .regex(/^\+?[\d\s().-]{6,}$/, 'Invalid phone number'),
    ),
    message: optional(z.string().trim().max(2000)),
  })
  .refine((lead) => lead.email || lead.phone, {
    message: 'An email or a phone number is required',
    path: ['email'],
  });

const bodySchema = z.object({
  lead: leadSchema,
  transcript: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(200)
    .optional(),
  page: z.string().url().max(500).optional().catch(undefined),
  lang: z.enum(LANGUAGES).optional().catch(undefined),
});

export interface ParsedLead {
  lead: LeadFields;
  transcript: ChatMessage[];
  page?: string;
  lang?: Language;
}

/** True when a request body is a lead submission rather than a chat turn. */
export const isLeadBody = (body: unknown): boolean =>
  typeof body === 'object' && body !== null && 'lead' in body;

/**
 * Validates a lead submission. The transcript keeps its most recent messages
 * up to `maxTranscriptChars`, so a long conversation can't make the webhook
 * payload unbounded.
 */
export function parseLead(body: unknown, maxTranscriptChars: number): ParsedLead | undefined {
  const result = bodySchema.safeParse(body);
  if (!result.success) return undefined;
  const { lead, transcript = [], page, lang } = result.data;

  const kept: ChatMessage[] = [];
  let chars = 0;
  for (const message of [...transcript].reverse()) {
    chars += message.content.length;
    if (chars > maxTranscriptChars) break;
    kept.unshift(message);
  }
  return { lead, transcript: kept, page, lang };
}

/** The JSON body the site's webhook receives. */
export interface LeadPayload extends ParsedLead {
  event: 'lead';
  id: string;
  createdAt: string;
  /** The company name from the site settings. */
  site: string;
}

export const SIGNATURE_HEADER = 'X-AI-Chat-Signature';

const hmac = (secret: string, timestamp: number, body: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`, the same scheme as Stripe's. */
export function signLead(
  body: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${hmac(secret, timestamp, body)}`;
}

/**
 * For the site's webhook receiver: checks that a lead really came from its
 * ai-chat endpoint and is recent. Pass the raw request body, before parsing it.
 */
export function verifyLeadSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  { toleranceSec = 300, now = Date.now() }: { toleranceSec?: number; now?: number } = {},
): boolean {
  const parts = Object.fromEntries(
    (header ?? '').split(',').map((part) => part.trim().split('=', 2)),
  );
  const timestamp = Number(parts.t);
  const given = parts.v1;
  if (!Number.isInteger(timestamp) || typeof given !== 'string' || !/^[0-9a-f]{64}$/.test(given))
    return false;
  if (Math.abs(now / 1000 - timestamp) > toleranceSec) return false;
  return timingSafeEqual(
    Buffer.from(hmac(secret, timestamp, rawBody), 'hex'),
    Buffer.from(given, 'hex'),
  );
}

export interface DeliverOptions {
  url: string;
  secret: string;
  payload: LeadPayload;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Posts the signed lead, retrying once on a network error or a 5xx. Resolves to the last HTTP status (0: no response). */
export async function deliverLead(
  options: DeliverOptions,
): Promise<{ ok: boolean; status: number }> {
  const { url, secret, payload, fetch: doFetch = fetch, timeoutMs = 10_000 } = options;
  const body = JSON.stringify(payload);
  let status = 0;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [SIGNATURE_HEADER]: signLead(body, secret) },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      await response.body?.cancel(); // only the status matters; free the connection
      if (response.ok) return { ok: true, status };
      if (status < 500) return { ok: false, status }; // the receiver rejected it: retrying won't help
    } catch {
      status = 0;
    }
  }
  return { ok: false, status };
}
