import { describe, expect, it, vi } from 'vitest';
import { deliverLead, parseLead, signLead, verifyLeadSignature, type LeadPayload } from './lead.js';

const valid = { lead: { name: 'Ana', email: 'ana@example.com', phone: '', message: 'Hola' } };

describe('parseLead', () => {
  it('accepts a name with an email or phone, treating empty fields as missing', () => {
    expect(parseLead(valid, 1000)?.lead).toEqual({
      name: 'Ana',
      email: 'ana@example.com',
      message: 'Hola',
    });
    expect(parseLead({ lead: { name: 'Ana', phone: '+58 412 123 4567' } }, 1000)).toBeDefined();
  });

  it('rejects a lead without any way to reply, or with bad fields', () => {
    expect(parseLead({ lead: { name: 'Ana' } }, 1000)).toBeUndefined();
    expect(parseLead({ lead: { name: '', email: 'a@b.co' } }, 1000)).toBeUndefined();
    expect(parseLead({ lead: { name: 'Ana', email: 'nope' } }, 1000)).toBeUndefined();
    expect(parseLead({ lead: { name: 'Ana', phone: 'call me' } }, 1000)).toBeUndefined();
  });

  it('keeps the most recent transcript that fits and ignores a bad page URL', () => {
    const transcript = [
      { role: 'user', content: 'x'.repeat(30) },
      { role: 'assistant', content: 'y'.repeat(30) },
      { role: 'user', content: 'z'.repeat(30) },
    ];
    const parsed = parseLead({ ...valid, transcript, page: 'not a url' }, 70);
    expect(parsed?.transcript.map((m) => m.content[0])).toEqual(['y', 'z']);
    expect(parsed?.page).toBeUndefined();
  });
});

describe('lead signatures', () => {
  const body = '{"event":"lead"}';
  const now = 1_790_000_000_000;

  it('verifies what it signs, within the tolerance', () => {
    const header = signLead(body, 'secret', now / 1000);
    expect(verifyLeadSignature(body, header, 'secret', { now })).toBe(true);
    expect(verifyLeadSignature(body, header, 'secret', { now: now + 301_000 })).toBe(false);
  });

  it('rejects a changed body, another secret or a malformed header', () => {
    const header = signLead(body, 'secret', now / 1000);
    expect(verifyLeadSignature(`${body} `, header, 'secret', { now })).toBe(false);
    expect(verifyLeadSignature(body, header, 'other', { now })).toBe(false);
    expect(verifyLeadSignature(body, 'v1=abc', 'secret', { now })).toBe(false);
    expect(verifyLeadSignature(body, null, 'secret', { now })).toBe(false);
  });
});

describe('deliverLead', () => {
  const payload = { event: 'lead', id: '1' } as LeadPayload;
  const options = (fetch: typeof globalThis.fetch) => ({
    url: 'https://hooks.test/lead',
    secret: 's',
    payload,
    fetch,
  });

  it('posts the JSON with a signature the receiver can verify', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    expect(await deliverLead(options(fetch))).toEqual({ ok: true, status: 204 });
    const init = fetch.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(verifyLeadSignature(String(init?.body), headers['X-AI-Chat-Signature'], 's')).toBe(true);
  });

  it('retries once on a 5xx or network error, never on a 4xx', async () => {
    const flaky = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    expect(await deliverLead(options(flaky))).toEqual({ ok: true, status: 200 });

    const down = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    expect(await deliverLead(options(down))).toEqual({ ok: false, status: 503 });
    expect(down).toHaveBeenCalledTimes(2);

    const refused = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));
    expect(await deliverLead(options(refused))).toEqual({ ok: false, status: 401 });
    expect(refused).toHaveBeenCalledTimes(1);
  });
});
