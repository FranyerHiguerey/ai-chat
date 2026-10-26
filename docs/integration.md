# Integrating ai-chat

There are two ways to put ai-chat on a site:

1. **In code.** A developer adds a config file, a folder of markdown knowledge and one server route. This works today.
2. **From a dashboard.** The site's own admin panel or CMS supplies the company info, widget settings and knowledge, so the owner can change the bot without a redeploy. ai-chat stays a library: it provides hooks a dashboard can feed, not a hosted service. See [section 2](#2-dashboard-hooks).

In both cases the provider API key lives only in the server's environment. It is never a config field, never stored by a dashboard and never sent to the browser.

> Before deploying publicly, go through the [pre-deploy checklist](#pre-deploy-checklist): the endpoint spends your API credit, and the guardrails only work as well as they are set up.

## 1. Code path

Install the server and browser packages:

```sh
pnpm add @franyerhiguerey/ai-chat-core @franyerhiguerey/ai-chat-widget
# or, in a React app: @franyerhiguerey/ai-chat-react
```

Add a config and a `knowledge/` folder of `.md` files:

```ts
// ai-chat.config.ts
import { defineConfig } from '@franyerhiguerey/ai-chat-core';

export default defineConfig({
  company: {
    name: 'Acme',
    description: 'What the company does, in one or two sentences.',
    contact: { email: 'hello@acme.example' },
  },
  knowledgeDir: './knowledge',
});
```

Set the provider in `.env` (see `.env.example`): `AI_CHAT_PROVIDER`, the matching key, and `AI_CHAT_MODEL` (required for OpenAI).

`createChatHandler()` is a web-standard `Request => Response` function, so most frameworks mount it directly.

### Astro

A static Astro site needs a server adapter for the chat route only:

```ts
// astro.config.mjs: add the adapter
import node from '@astrojs/node';
export default defineConfig({ adapter: node({ mode: 'standalone' }) });
```

```ts
// src/pages/api/chat.ts
import { createChatHandler, loadEnv } from '@franyerhiguerey/ai-chat-core';
import type { APIRoute } from 'astro';
import config from '../../../ai-chat.config';

export const prerender = false;

const handler = createChatHandler({ config, env: loadEnv(import.meta.env) });
export const POST: APIRoute = ({ request, clientAddress }) =>
  handler(request, { clientIp: clientAddress });
```

### Next.js (App Router)

```ts
// app/api/chat/route.ts
// On Vercel, the platform overwrites x-forwarded-for, so it can be trusted.
const handler = createChatHandler({ config, env: loadEnv(), trustProxyHeader: 'x-forwarded-for' });
export const POST = (request: Request) => handler(request);
```

### Hono

```ts
// With @hono/node-server; on Cloudflare use trustProxyHeader: 'cf-connecting-ip' instead.
app.post('/api/chat', (c) => handler(c.req.raw, { clientIp: c.env.incoming.socket.remoteAddress }));
```

### Express

Express does not use web-standard requests; an adapter is planned for M9.

### The widget

```html
<script src="/ai-chat.global.js" defer></script>
<ai-chat endpoint="/api/chat" name="Acme assistant" lang="es"></ai-chat>
```

See [packages/widget/README.md](../packages/widget/README.md) for attributes, theming tokens and methods, and [packages/react/README.md](../packages/react/README.md) for `<AiChat>`.

## Guardrails

Every check runs before the model is called, so a rejected request costs nothing. In order:

| Check          | Setting (`limits` unless noted)                       | Default                        | Response                           |
| -------------- | ----------------------------------------------------- | ------------------------------ | ---------------------------------- |
| Origin         | `allowedOrigins` (top level)                          | own origin only                | 403 `forbidden_origin`             |
| Rate per IP    | `rpmPerIp`                                            | 10 / minute                    | 429 `rate_limited` + `Retry-After` |
| Rate, everyone | `rpmGlobal`                                           | 60 / minute                    | 429                                |
| Concurrent     | `maxConcurrentPerIp`                                  | 2 replies                      | 429                                |
| Body size      | `maxBodyBytes`                                        | 100 KB                         | 413 `message_too_long`             |
| Message size   | `maxMessageChars`, `maxConversationChars`, `maxTurns` | 2,000 / 20,000 chars, 20 turns | 400                                |
| Daily budget   | `dailyTokenBudget` (0 turns it off)                   | 1,000,000                      | 503 `unavailable`                  |
| Reply length   | `maxTokens`                                           | 1,024                          | reply ends with `max_tokens`       |

**Origins.** With `allowedOrigins` empty, only pages on the endpoint's own origin may call it. To embed the widget on other sites, list them. Behind a proxy that rewrites the `Host` header, the endpoint can't see its public origin, so list it explicitly. Requests without an `Origin` header (curl, scripts) aren't browsers embedding the bot and are left to the rate limits: the origin check stops other sites from using your bot, not scripts.

**The visitor's IP.** A web `Request` doesn't carry it, so pass it as the handler's second argument (`{ clientIp }`), as in the snippets above. Where the framework doesn't expose it, set `trustProxyHeader` to the header your host overwrites (`x-forwarded-for` on Vercel and most proxies, `cf-connecting-ip` on Cloudflare). Never trust a header the visitor can set directly. For `x-forwarded-for` only the rightmost entry is used. Without either, every visitor shares one bucket and a warning is logged once.

**The daily budget** counts weighted tokens across all visitors, per UTC day: `input + cache writes + output + cache reads × 0.1`. Cache reads are discounted because both providers bill them at about a tenth. This is a ceiling for runaway spend, not an invoice. Output usually costs several times more than input, so to turn a dollar limit into a budget, use your model's output price as the rate for a conservative estimate.

**Several instances.** Counters live in memory by default, so each serverless instance or process keeps its own. Pass a shared `store` (anything with `incr(key, amount, ttlMs)`, e.g. Redis `INCRBYFLOAT` + `PEXPIRE`) to enforce the limits across all of them. The concurrency limit is always per process.

**Usage logging.** Each request writes one `ai-chat.request` JSON line: outcome, status, error code, duration, a salted hash of the IP, origin, language, finish reason, usage, weighted tokens and the day's budget used so far. It never contains message text, raw IPs or keys. Pass `logger` to send the entries elsewhere.

### Pre-deploy checklist

- [ ] The API key is only in the server environment (`.env` is not committed, nothing is prefixed for the browser such as `PUBLIC_`).
- [ ] The handler gets the real visitor IP: `{ clientIp }` or a `trustProxyHeader` your host overwrites. No "Client IP unknown" warning in the logs.
- [ ] `allowedOrigins` lists every site that embeds the widget (or is empty for same-site only).
- [ ] `dailyTokenBudget` matches what you are willing to spend in a day; `rpmPerIp` and `rpmGlobal` fit your traffic.
- [ ] On serverless or multiple instances, a shared `store` is configured.
- [ ] A spending limit is also set in the provider's console, as a second line of defense.

## 2. Dashboard hooks

Without a source, the handler reads `config` and its knowledge folder once per process. With a source, the bot's content comes from wherever the dashboard keeps it, and edits apply without a redeploy.

### Site settings and deploy config

A dashboard edits only the **site settings**. Everything that protects your API credit stays in code, so no dashboard form can loosen it:

| Site settings (owner, from a dashboard)                                                       | Deploy config (developer, in code)                                                                                 |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `company` (name, description, website, contact, hours), `languages` (default, tone), `widget` | `limits`, `allowedOrigins`, `features` (lead webhook, handoff), `knowledgeDir`; provider, model and API key in env |

`widget` holds what the visitor sees: `name`, `avatar`, `greeting`, `starters`, `teaser` and a `handoff` link, with texts given once or per language (`{ es, en }`).

### Sources

```ts
interface ChatSource {
  load(): Promise<{ settings?: SiteSettingsInput; knowledge: KnowledgeDoc[] }>;
}
```

| Source                             | Use                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `staticSource(data or () => data)` | Data the site has in memory, or a function that fetches it from its database or CMS.      |
| `folderSource({ dir })`            | A folder with an optional `settings.json` and `.md` files (what `examples/admin` writes). |
| `cachedSource(source, { ttlMs })`  | Loads at most once per `ttlMs`. If a reload fails, the last good data keeps serving.      |

```ts
const handler = createChatHandler({
  config, // deploy config; its company is the fallback until the source has settings
  env: loadEnv(),
  source: cachedSource(
    staticSource(async () => ({
      settings: await db.getChatSettings(siteId),
      knowledge: await db.getKnowledgeDocs(siteId), // [{ file, content }]
    })),
    { ttlMs: 60_000 },
  ),
});
```

The handler loads the source on each chat request and rebuilds the system prompt **only when the content changes** (it hashes settings and knowledge). Prompt caching needs identical prompt bytes between requests, so a source must not add dates, IDs or random values to its content.

If new settings are invalid, or the knowledge is over `limits.maxKnowledgeChars` (default 200,000 characters), the handler logs an `ai-chat.error` with `stage: "source"` and keeps answering from the last good version. The cap exists because every request sends the whole knowledge: one oversized upload would otherwise multiply the cost of every message.

### Building the admin forms

The dashboard renders its own forms. Core helps it validate them:

- `validateSiteSettings(input)` returns `{ ok: true, value }` or `{ ok: false, issues: [{ path, message }] }`, with paths like `company.contact.email`, so each error can sit next to its field. Keys that aren't site settings are dropped.
- `validateConfig(input)` does the same for a whole config.
- `siteSettingsJsonSchema` is the site settings as JSON Schema (draft 7), for form generators or client-side checks.

### Public widget settings

`GET` on the chat endpoint returns `{ "protocol": 1, "widget": { … } }`, cacheable for 60 seconds. It never calls the model, so it isn't rate limited. Add `remote-config` to the widget to use it:

```html
<ai-chat endpoint="/api/chat" remote-config></ai-chat>
```

Attributes on `<ai-chat>` and its `config` property still win over the served settings.

## 3. Owner knowledge uploads

`@franyerhiguerey/ai-chat-ingest` (Node only) turns uploaded files into knowledge documents:

```ts
import { toKnowledgeDoc, IngestError } from '@franyerhiguerey/ai-chat-ingest';

const doc = await toKnowledgeDoc({ name: 'Lista de Precios.pdf', type: 'application/pdf', bytes });
// { file: 'lista-de-precios.md', content: '…plain text…' }
```

| Type            | How                                           |
| --------------- | --------------------------------------------- |
| `.md`, `.txt`   | Used as is, line endings normalized           |
| `.html`, `.htm` | Scripts and styles dropped, converted to text |
| `.pdf`          | Text extracted with `unpdf` (install it)      |
| `.docx`         | Text extracted with `mammoth` (install it)    |
| Anything else   | `IngestError` with code `unsupported_type`    |

Other error codes: `too_large` (default 10 MB), `empty` (for example a scanned PDF without a text layer) and `missing_parser`. `file` is always a safe slug ending in `.md`, so it can be used as a file name without path tricks.

Convert **when the owner uploads**, not during a chat: parsing is slow, and stored text keeps the prompt fast and stable. Store the result wherever the dashboard keeps data and return it from the source.

## 4. Catalog import (planned: M7)

A `CatalogItem` schema (id, name, description, price, currency, url, image, tags) and `parseCatalog(csv | json)` in ai-chat-ingest, which returns row-level errors for the dashboard to show.

A small catalog is added to the knowledge. A large one stays out of the prompt and is reached through the M7 `search_catalog` tool, whose results the widget renders as item cards.

## 5. Visitor attachments (planned: M8)

Visitors can attach images or PDFs, for example a spec sheet or a photo for a quote.

1. The widget uploads the file with `POST {endpoint}/upload` (multipart). The server checks the type (png, jpeg, webp, pdf by default), the size (5 MB by default) and a per-conversation count, then stores the file through an `AttachmentStore` adapter: in memory with a TTL by default, or the site's own storage. It returns an `id`.
2. Chat messages refer to the file by id. Message `content` becomes `string | Part[]`, with `{ type: 'text', text }` and `{ type: 'file', id }` parts. File bytes never travel in the chat body, so they aren't re-sent every turn. Protocol v1 clients keep working.
3. The server maps parts to each provider's native inputs (Anthropic image and document blocks; OpenAI `input_image` and `input_file`).

Configured with `features.attachments: { enabled, maxBytes, types }`. Attachments can also be forwarded to the lead webhook. Like the knowledge, their content is treated as data, never as instructions.

Uploads add storage and token cost per visitor, so they get their own size, count and rate limits on top of the guardrails above.

## 6. Reference dashboard

[`examples/admin`](../examples/admin) is a small demo, not a product. Run it with `pnpm admin` (port 4322) after setting `ADMIN_PASSWORD` in `.env`.

- **Settings:** a hand-written form, validated with `validateSiteSettings`, errors shown per field.
- **Knowledge:** upload (md, txt, HTML, PDF, DOCX through ai-chat-ingest), list with the character budget, delete.
- **Preview:** the widget with `remote-config`, and an embed snippet to copy.
- Everything is stored in `examples/admin/data/` (`settings.json` plus `.md` files, copied from `seed/` on first run) and read by `cachedSource(folderSource(...))` with a 5-second TTL.
- Admin routes need HTTP Basic auth. Their POSTs must come from the dashboard's own origin, because browsers resend Basic credentials automatically, which would otherwise allow cross-site form posts.

A real dashboard brings its own authentication, storage and hosting.

## Roadmap

| Milestone | Scope                                                                           |
| --------- | ------------------------------------------------------------------------------- |
| M5        | Guardrails: rate limit, origin/CORS, caps, usage logging (done)                 |
| M6        | Sources, form helpers, public settings, ai-chat-ingest, `examples/admin` (done) |
| M7        | Tools and rich UI: suggestions, item cards and catalog, handoff card, lead form |
| M8        | Visitor attachments (protocol v2)                                               |
| M9        | Express adapter, Astro example, first real site integration                     |
| M10       | Docs, CI, npm release                                                           |
