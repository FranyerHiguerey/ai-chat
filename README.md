# ai-chat

A white-label AI chat assistant you can drop into any website. Each site brings its own
content (company info, FAQ, services, product catalog) and its own API key, which stays
on the site's server and never reaches the browser. It works with Claude (default) or
OpenAI.

- **Answers from your content only**: markdown knowledge files, PDF/DOCX/HTML uploads, a CSV catalog.
- **Rich replies**: product cards, reply chips, a WhatsApp/email handoff card and an inline lead form sent to your webhook (HMAC-signed).
- **Safe to deploy**: same-origin by default, rate limits, size caps, a daily token budget and one JSON log line per request with no visitor text or raw IPs.
- **Cheap to run**: the prompt is cached between requests, and the catalog stays out of it.
- **Editable without code**: a site's own dashboard or CMS can feed settings, knowledge and catalog through a source.
- **Works anywhere**: a web-standard `Request => Response` handler (Astro, Next.js, Hono, serverless), a zero-dependency `<ai-chat>` Web Component, and a React wrapper. Spanish and English.

> **Status:** v0.1.3, pre-1.0, so the API can still change. In production at [hisiverplast.com](https://hisiverplast.com) ([case study](docs/case-study.md)). Not on npm yet: install from the [GitHub release](https://github.com/FranyerHiguerey/ai-chat/releases) (below).

## Packages

| Package                                              | What it is                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`@franyerhiguerey/ai-chat-core`](packages/core)     | Server: config, knowledge, sources, guardrails, Claude/OpenAI providers, the chat handler |
| [`@franyerhiguerey/ai-chat-client`](packages/client) | Browser client: `streamChat()` and `submitLead()`, zero dependencies                      |
| [`@franyerhiguerey/ai-chat-widget`](packages/widget) | The `<ai-chat>` Web Component, zero dependencies                                          |
| [`@franyerhiguerey/ai-chat-react`](packages/react)   | `<AiChat />` wrapper for React                                                            |
| [`@franyerhiguerey/ai-chat-ingest`](packages/ingest) | Node: turns uploads (md, txt, HTML, PDF, DOCX) into knowledge and CSV/JSON into a catalog |

## Install (from the GitHub release)

Until the npm release, add the packages you use straight from the release, plus your provider's SDK:

```json
{
  "dependencies": {
    "@franyerhiguerey/ai-chat-core": "https://github.com/FranyerHiguerey/ai-chat/releases/download/v0.1.3/franyerhiguerey-ai-chat-core-0.1.3.tgz",
    "@franyerhiguerey/ai-chat-widget": "https://github.com/FranyerHiguerey/ai-chat/releases/download/v0.1.3/franyerhiguerey-ai-chat-widget-0.1.3.tgz",
    "openai": "^7.43.0"
  }
}
```

Use `@anthropic-ai/sdk` instead of `openai` for Claude. Add `ai-chat-react`, `ai-chat-client` or `ai-chat-ingest` the same way if you use them. The packages refer to each other only as peer dependencies, so nothing else is fetched and no overrides are needed. That matters for pnpm 11, which blocks URL sub-dependencies by default. The React wrapper needs the widget installed too.

## Quick start

1. Configure the server (see [docs/integration.md](docs/integration.md) for Astro, Next.js and Hono):

   ```ts
   import { createChatHandler, defineConfig, loadEnv } from '@franyerhiguerey/ai-chat-core';

   const handler = createChatHandler({
     config: defineConfig({
       company: { name: 'Acme', description: 'What the company does.' },
       knowledgeDir: './knowledge', // a folder of .md files
     }),
     env: loadEnv(), // AI_CHAT_PROVIDER, the provider's key, AI_CHAT_MODEL (see .env.example)
   });
   // Mount on POST /api/chat, passing the visitor IP: handler(request, { clientIp })
   ```

2. Add the widget to the page. In a bundled app (Astro, Vite, Next.js), import it once:

   ```html
   <script type="module">
     import '@franyerhiguerey/ai-chat-widget';
   </script>
   <ai-chat endpoint="/api/chat" name="Acme assistant"></ai-chat>
   ```

   On a plain HTML page, serve `dist/ai-chat.global.js` (the `./global` export) and load it with `<script src="/ai-chat.global.js" defer></script>` instead.

3. Before going public, go through the [pre-deploy checklist](docs/integration.md#pre-deploy-checklist).

| Provider            | `.env`                                                                         | Install                      |
| ------------------- | ------------------------------------------------------------------------------ | ---------------------------- |
| Anthropic (default) | `ANTHROPIC_API_KEY`, optional `AI_CHAT_MODEL` (defaults to `claude-haiku-5-5`) | `pnpm add @anthropic-ai/sdk` |
| OpenAI              | `AI_CHAT_PROVIDER=openai`, `OPENAI_API_KEY`, `AI_CHAT_MODEL` (required)        | `pnpm add openai`            |

## Docs

- [Integration guide](docs/integration.md): frameworks, guardrails, dashboards and sources, uploads, catalog, chips/handoff/leads.
- [Protocol](docs/protocol.md): the SSE events, cards, leads and webhook signatures, for writing your own client.
- [Releasing](docs/releasing.md): CI, tag-driven releases and npm publishing.
- [Case study](docs/case-study.md): the architecture, the decisions behind it and the first production deployment.
- [Widget](packages/widget/README.md) and [React](packages/react/README.md) options.

## Development

```bash
pnpm install
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

- `pnpm playground` (http://localhost:4321): the stream inspector and a sample site at `/widget`. It answers as Plastinova, a fictional packaging company whose sample knowledge and catalog live in `examples/playground/`. Its **Mock** mode needs no API key.
- `pnpm admin` (http://localhost:4322): a reference dashboard to edit settings, knowledge and the catalog without code. Set `ADMIN_PASSWORD` in `.env`.
- `pnpm --filter @franyerhiguerey/ai-chat-core live-check`: checks streaming and prompt caching against the real API (a fraction of a cent).

## Roadmap

- [x] Core, streaming protocol, browser client, widget, React wrapper
- [x] Guardrails: origin/CORS, rate limits, size caps, daily budget, usage logging
- [x] Sources and dashboard hooks, uploads (`ai-chat-ingest`), reference dashboard
- [x] Tools and rich UI: reply chips, handoff card, lead form, catalog search and product cards
- [ ] Visitor attachments (images, PDFs)
- [ ] Express adapter, Astro example, first production site
- [ ] CI and npm release

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
