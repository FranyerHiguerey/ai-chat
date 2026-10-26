export interface SSEMessage {
  event: string;
  data: string;
}

/**
 * Parses a Server-Sent Events byte stream into messages, following the HTML
 * spec's rules: lines may end in \n, \r\n or \r, chunks may split anywhere
 * (even inside a UTF-8 character), `data:` lines accumulate, comments are skipped.
 */
export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let finished = false;

  function* processLines(final: boolean): Generator<SSEMessage> {
    for (;;) {
      const match = /\r\n|\r|\n/.exec(buffer);
      // A trailing \r might be the first half of \r\n: wait for more input.
      if (!match || (match[0] === '\r' && match.index === buffer.length - 1 && !final)) return;

      const line = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);

      if (line === '') {
        if (data.length > 0) yield { event: event || 'message', data: data.join('\n') };
        event = '';
        data = [];
        continue;
      }
      if (line.startsWith(':')) continue;

      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);

      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      yield* processLines(false);
    }
    buffer += decoder.decode();
    yield* processLines(true);
    finished = true;
  } finally {
    // Stopped early (consumer broke out, or an error): release the connection.
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
