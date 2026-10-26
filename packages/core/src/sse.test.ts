import { describe, expect, it } from 'vitest';
import { encodeComment, encodeEvent } from './sse.js';

describe('encodeEvent', () => {
  it('writes the type as the event name and the rest as JSON data', () => {
    expect(encodeEvent({ type: 'delta', text: 'Hola' })).toBe(
      'event: delta\ndata: {"text":"Hola"}\n\n',
    );
  });

  it('keeps multi-line text on one data line', () => {
    const frame = encodeEvent({ type: 'delta', text: 'a\n\nb' });
    expect(frame).toBe('event: delta\ndata: {"text":"a\\n\\nb"}\n\n');
    expect(frame.split('\n\n')).toHaveLength(2);
  });
});

describe('encodeComment', () => {
  it('writes an SSE comment', () => {
    expect(encodeComment('ping')).toBe(': ping\n\n');
  });
});
