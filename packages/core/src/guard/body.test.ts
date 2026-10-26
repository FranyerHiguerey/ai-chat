import { describe, expect, it } from 'vitest';
import { readJsonBody } from './body.js';

const post = (body: RequestInit['body'], headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/chat', {
    method: 'POST',
    body,
    headers,
    duplex: 'half',
  } as RequestInit);

/** A body with no Content-Length, delivered in chunks. */
function chunked(...parts: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
      controller.close();
    },
  });
}

describe('readJsonBody', () => {
  it('parses a JSON body within the limit', async () => {
    expect(await readJsonBody(post('{"a":1}'), 100)).toEqual({ ok: true, value: { a: 1 } });
  });

  it('rejects on Content-Length before reading', async () => {
    const result = await readJsonBody(post('{}', { 'content-length': '5000' }), 100);
    expect(result).toEqual({ ok: false, reason: 'too_large' });
  });

  it('counts bytes while reading a body without a length', async () => {
    const big = await readJsonBody(post(chunked('{"a":"', 'x'.repeat(200), '"}')), 100);
    expect(big).toEqual({ ok: false, reason: 'too_large' });
    expect(await readJsonBody(post(chunked('{"a":', '1}')), 100)).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it('reports a body that is not JSON', async () => {
    expect(await readJsonBody(post('{nope'), 100)).toEqual({ ok: false, reason: 'invalid' });
  });
});
