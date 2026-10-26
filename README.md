# ai-chat

A config-driven AI chatbot you can drop into any website. It works with Claude
(default) or OpenAI. Each site supplies its own content (company info, FAQ,
services as markdown) and its own API key; the key stays on the site's server
and never reaches the browser.

## Providers

Pick one with `AI_CHAT_PROVIDER` and install only that SDK next to the core:

| Provider            | `.env`                                                                         | Install                      |
| ------------------- | ------------------------------------------------------------------------------ | ---------------------------- |
| Anthropic (default) | `ANTHROPIC_API_KEY`, optional `AI_CHAT_MODEL` (defaults to `claude-haiku-5-5`) | `pnpm add @anthropic-ai/sdk` |
| OpenAI              | `AI_CHAT_PROVIDER=openai`, `OPENAI_API_KEY`, `AI_CHAT_MODEL` (required)        | `pnpm add openai`            |

> **Status:** early development (Milestone 3 of 7). Not published to npm yet.

## Packages

| Package                                                                                                                      | Status      |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `@franyerhiguerey/ai-chat-core`: config, knowledge, prompt, Claude/OpenAI providers, streaming `Request => Response` handler | in progress |
| `@franyerhiguerey/ai-chat-client`: browser client that streams replies (`streamChat()`), zero dependencies                   | in progress |
| [`@franyerhiguerey/ai-chat-widget`](packages/widget): `<ai-chat>` Web Component, designed in Stitch, zero dependencies       | in progress |
| [`@franyerhiguerey/ai-chat-react`](packages/react): `<AiChat />` wrapper                                                     | in progress |
| `@franyerhiguerey/ai-chat-adapter-express`: Express middleware                                                               | planned     |

The browser and server speak a small SSE protocol, documented in [docs/protocol.md](docs/protocol.md).

## Development

```bash
pnpm install
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

### Playground

A bare page that shows the stream and every protocol event with timings. Copy
`.env.example` to `.env`, set the provider and its key, then:

```bash
pnpm playground   # http://localhost:4321
```

It answers as Plastinova, a fictional packaging company whose knowledge lives in
`examples/playground/knowledge/`.

`/widget` shows the `<ai-chat>` widget on a sample site, with controls for brand,
language and theme. Its **Mock** stream needs no API key and costs nothing; type
`error`, `corte`, `red` or `lento` to try the error, cut-off, dropped-connection
and slow cases.

### Live cache check

Sends the same question twice and confirms the second call reads the prompt from
the cache (costs a fraction of a cent):

```bash
pnpm --filter @franyerhiguerey/ai-chat-core live-check
```

## Roadmap

1. Monorepo, config, knowledge loader, cached prompt, first call (Claude and OpenAI) ✅
2. Streaming handler, protocol, browser client, playground, [Stitch brief](docs/design/stitch-brief.md) ✅
3. Widget from the Stitch design: Web Component, safe markdown, smooth streaming UI, starter chips, persistence, a11y, React wrapper ✅
4. Tools and rich UI: reply chips, product cards, WhatsApp handoff card, inline lead form (signed webhook)
5. Guardrails: rate limit, origin/CORS, caps, usage logging
6. Express adapter, Astro example, dogfood on a real site
7. Docs, CI, first npm release

## License

MIT
