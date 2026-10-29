# Changelog

## 0.2.0 (2026-10-29)

- **Core: custom tools.** `defineTool({ name, description, instructions?, parameters, run })` gives the model a server-side function, such as a price calculator or a stock lookup. Arguments are validated with Zod and sent to providers as strict JSON Schema; errors and timeouts (10 s) become a short result for the model and a server log line. Replies may take a third model call when a site has custom tools. See [Custom tools](docs/integration.md#custom-tools).
- **Releases:** published to npm (`pnpm release:npm`); CI and a tag-driven release workflow are in the repo.

## 0.1.3 (2026-10-27)

- **Fix (widget):** in 0.1.2, scrolling the mouse wheel over the product cards did nothing: the card row contained overscroll on both axes, which swallowed vertical wheel input. It now contains only the horizontal axis, so the conversation scrolls normally under the pointer. Found by testing the real site in Chrome with real smooth scrolling.

## 0.1.2 (2026-10-27)

- **Widget:** on pages with smooth scrolling (Lenis and similar), wheel and touch events inside the open chat no longer reach the page, so the conversation scrolls instead of the page. On a phone the page behind the full-screen chat no longer rubber-bands.
- **Catalog:** `image` and `url` can be a path on the site (`/images/chat/jar.webp`), resolved against the page that embeds the widget. Protocol-relative (`//host`) links are rejected.
- **Widget:** product photos are shown whole in a square frame (`contain`) instead of cropped, which suits transparent product renders.

## 0.1.1 (2026-10-26)

- **Fix:** installing from the GitHub release with pnpm 11 failed, because pnpm blocks sub-dependencies that resolve to URLs. `ai-chat-react` now takes the widget as a peer dependency, so installs need no overrides. Install the widget next to the React wrapper.

## 0.1.0 (2026-10-26)

First public release. Installable from the GitHub release; not on npm yet.

- **Core:** `defineConfig`, `loadEnv`, markdown knowledge, a system prompt cached between requests, Claude and OpenAI providers, and `createChatHandler()`, a web-standard `Request => Response` SSE endpoint.
- **Guardrails:** same-origin by default with an `allowedOrigins` list and CORS, per-IP, global and concurrent rate limits, body and conversation size caps, a daily weighted-token budget, and one JSON log line per request without visitor text or raw IPs.
- **Dashboard hooks:** sources (`staticSource`, `folderSource`, `cachedSource`) for settings, knowledge and catalog; a split between site settings and deploy config; `validateSiteSettings`; and public widget settings over `GET`.
- **Rich replies:** reply chips, a WhatsApp/email handoff card, an inline lead form posted to an HMAC-signed webhook (`verifyLeadSignature`), and catalog search with product cards, all through a two-round tool loop on both providers.
- **Client:** `streamChat()` and `submitLead()`.
- **Widget:** the `<ai-chat>` Web Component, with Shadow DOM, theme tokens, dark mode, mobile full screen, safe markdown, error states, persistence, es/en, `remote-config`, and the cards and form above.
- **React:** the `<AiChat />` wrapper.
- **Ingest:** `toKnowledgeDoc` (md, txt, HTML, PDF, DOCX) and `parseCatalog` (CSV/JSON with Spanish and English columns).
- **Examples:** a playground with a free mock stream, and a reference admin dashboard.
