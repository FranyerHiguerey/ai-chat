# Changelog

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
