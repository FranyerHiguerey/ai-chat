/** Test helpers: fake ai-chat endpoints that answer with SSE. */

export const frame = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export const reply = (...texts: string[]): string =>
  [
    frame('start', { id: '1', protocol: 1 }),
    ...texts.map((text) => frame('delta', { text })),
    frame('done', { finishReason: 'stop' }),
  ].join('');

export const sse = (body: string): Response =>
  new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });

/** A fetch whose stream stays open until the test pushes frames or closes it. */
export function openStream() {
  let push!: (chunk: string) => void;
  let close!: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      push = (chunk) => controller.enqueue(encoder.encode(chunk));
      close = () => controller.close();
    },
  });
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.addEventListener('abort', () => {
      try {
        close();
      } catch {
        // Already closed.
      }
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  return { fetch, push: (chunk: string) => push(chunk), close: () => close() };
}
