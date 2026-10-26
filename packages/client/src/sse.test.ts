import { describe, expect, it } from 'vitest';
import { parseSSE, type SSEMessage } from './sse.js';

/** A byte stream that delivers `chunks` one by one, the way a network would. */
function streamOf(chunks: (string | Uint8Array)[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

async function parse(chunks: (string | Uint8Array)[]) {
  const out: SSEMessage[] = [];
  for await (const message of parseSSE(streamOf(chunks))) out.push(message);
  return out;
}

describe('parseSSE', () => {
  it('parses named events', async () => {
    expect(await parse(['event: delta\ndata: {"text":"Hi"}\n\n'])).toEqual([
      { event: 'delta', data: '{"text":"Hi"}' },
    ]);
  });

  it('handles chunks split mid-line and mid-event', async () => {
    const frames = 'event: start\ndata: {"id":"1"}\n\nevent: delta\ndata: {"text":"Hola"}\n\n';
    const oneByteAtATime = frames.split('');
    expect(await parse(oneByteAtATime)).toEqual([
      { event: 'start', data: '{"id":"1"}' },
      { event: 'delta', data: '{"text":"Hola"}' },
    ]);
  });

  it('handles a UTF-8 character split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: ñandú\n\n');
    const splitInsideÑ = [bytes.slice(0, 7), bytes.slice(7)];
    expect(await parse(splitInsideÑ)).toEqual([{ event: 'message', data: 'ñandú' }]);
  });

  it('supports \\r\\n and \\r line endings, even when \\r\\n is split', async () => {
    expect(await parse(['event: a\r', '\ndata: 1\r\n\r\n', 'event: b\rdata: 2\r\r'])).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
  });

  it('joins multi-line data and skips comments and empty events', async () => {
    expect(await parse([': ping\n\n', 'data: line 1\ndata: line 2\n\n', 'event: x\n\n'])).toEqual([
      { event: 'message', data: 'line 1\nline 2' },
    ]);
  });

  it('drops an unterminated last event', async () => {
    expect(await parse(['data: complete\n\n', 'data: cut off'])).toEqual([
      { event: 'message', data: 'complete' },
    ]);
  });
});
