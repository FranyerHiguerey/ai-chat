/**
 * A fake chat endpoint for trying the widget with no API key and no cost.
 * It streams a canned markdown reply in small chunks. Words in the last
 * message pick other scenarios: "error", "busy"/"demanda", "limit"/"límite",
 * "cut"/"corte", "network"/"red", "slow"/"lento".
 */
const REPLIES = {
  es: [
    'Para pedidos estándar, el tiempo de entrega es de **3 a 5 días hábiles** desde la confirmación del pago.',
    '',
    'Incluye:',
    '- **Preparación:** 1 a 2 días.',
    '- **Envío nacional:** 2 a 3 días, con número de seguimiento.',
    '',
    'Más detalles en [nuestra página de envíos](https://example.com/envios).',
  ].join('\n'),
  en: [
    'Standard orders arrive in **3 to 5 business days** after payment is confirmed.',
    '',
    'That includes:',
    '- **Preparation:** 1 to 2 days.',
    '- **Shipping:** 2 to 3 days, with a tracking number.',
    '',
    'More details on [our shipping page](https://example.com/shipping).',
  ].join('\n'),
};

// Same wording as the server's fixed strings (core/src/i18n.ts).
const ERRORS = {
  unavailable: {
    es: 'El asistente no está disponible en este momento. Inténtalo de nuevo.',
    en: 'The assistant is not available right now. Please try again.',
  },
  rate_limited: {
    es: 'Estamos recibiendo muchas consultas. Inténtalo de nuevo en unos segundos.',
    en: "We're getting a lot of questions right now. Please try again in a few seconds.",
  },
  too_many_turns: {
    es: 'Esta conversación es muy larga. Empieza una nueva para seguir.',
    en: 'This conversation is very long. Start a new one to continue.',
  },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export async function handleMockChat(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    messages?: { content?: string }[];
    lang?: string;
  };
  const lang = body.lang === 'en' ? 'en' : 'es';
  const last = (body.messages?.at(-1)?.content ?? '').toLowerCase();
  const has = (...words: string[]) => words.some((word) => last.includes(word));
  const text = REPLIES[lang];
  // Rejected before the stream opens, like the real handler.
  if (has('limit', 'límite')) {
    const error = { code: 'too_many_turns', message: ERRORS.too_many_turns[lang] };
    return Response.json({ error }, { status: 400 });
  }
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      try {
        send(frame('start', { id: crypto.randomUUID(), protocol: 1 }));
        await sleep(500);
        const failure = has('error')
          ? 'unavailable'
          : has('busy', 'demanda')
            ? 'rate_limited'
            : null;
        if (failure) {
          send(frame('error', { code: failure, message: ERRORS[failure][lang] }));
          return controller.close();
        }
        const cut = has('cut', 'corte');
        const network = has('network', 'red');
        const delay = has('slow', 'lento') ? 120 : 25;
        const end = cut || network ? Math.floor(text.length / 2) : text.length;
        for (let i = 0; i < end;) {
          const size = 2 + Math.floor(Math.random() * 5);
          send(frame('delta', { text: text.slice(i, Math.min(i + size, end)) }));
          i += size;
          await sleep(delay);
          if (request.signal.aborted) return;
        }
        // "network": close without done, as a dropped connection would.
        if (!network) send(frame('done', { finishReason: cut ? 'max_tokens' : 'stop' }));
        controller.close();
      } catch {
        // The visitor stopped the reply: the stream is already closed.
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
