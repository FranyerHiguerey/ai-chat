import { describe, expect, it } from 'vitest';
import { checkOrigin } from './origin.js';

const from = (origin?: string) =>
  new Request('https://shop.example/api/chat', {
    method: 'POST',
    headers: origin ? { Origin: origin } : {},
  });

describe('checkOrigin', () => {
  it('lets requests without Origin through (not a browser)', () => {
    expect(checkOrigin(from(), [])).toEqual({ ok: true });
  });

  it('accepts only the same origin when the list is empty', () => {
    expect(checkOrigin(from('https://shop.example'), [])).toEqual({ ok: true });
    expect(checkOrigin(from('https://evil.example'), [])).toEqual({ ok: false });
    expect(checkOrigin(from('http://shop.example'), [])).toEqual({ ok: false });
  });

  it('accepts listed origins and returns them for CORS', () => {
    const allowed = ['https://www.shop.example/', 'https://landing.example:443'];
    expect(checkOrigin(from('https://www.shop.example'), allowed)).toEqual({
      ok: true,
      corsOrigin: 'https://www.shop.example',
    });
    expect(checkOrigin(from('https://landing.example'), allowed)).toMatchObject({ ok: true });
    expect(checkOrigin(from('https://evil.example'), allowed)).toEqual({ ok: false });
  });

  it('needs no CORS headers when a listed origin is the endpoint itself', () => {
    expect(checkOrigin(from('https://shop.example'), ['https://shop.example'])).toEqual({
      ok: true,
    });
  });

  it('rejects a malformed or opaque Origin', () => {
    expect(checkOrigin(from('null'), [])).toEqual({ ok: false });
  });
});
