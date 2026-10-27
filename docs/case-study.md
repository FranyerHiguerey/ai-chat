# ai-chat: a white-label AI assistant for business websites

**Role:** Author and sole developer (design, architecture, code, infrastructure)
**Type:** Open-source library ([MIT](../LICENSE)), in production at [hisiverplast.com](https://hisiverplast.com)
**Contact:** Franyer Higuerey ([GitHub](https://github.com/FranyerHiguerey))

---

## Overview

ai-chat is a chatbot that a business adds to its website with one HTML tag. It answers visitors from the company's own knowledge (FAQs, documents, a product catalog with prices), shows matching products as cards, and turns interested visitors into sales leads delivered by email or WhatsApp.

It is built as a library, not a hosted service: the business keeps its data and its AI provider account (Claude or OpenAI), and the same code serves any brand through configuration. Its first production deployment is the website of Hisiverplast, an industrial plastic-packaging manufacturer in Venezuela, where it quotes real prices for 13 products in Spanish.

---

## Tech Stack

| Layer            | Technologies                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------- |
| **Language**     | TypeScript (strict), ES modules                                                             |
| **Monorepo**     | pnpm workspaces, Turborepo, tsup                                                            |
| **Server core**  | Web-standard `Request` → `Response` handler, Zod, Server-Sent Events                        |
| **AI providers** | Anthropic Claude (with prompt caching) and OpenAI, behind one interface                     |
| **Widget**       | Web Component with Shadow DOM, no framework, CSS custom properties                          |
| **Integrations** | React wrapper; examples for Astro, Next.js and Hono                                         |
| **Ingestion**    | Markdown, HTML, PDF, DOCX and CSV catalogs to knowledge documents                           |
| **Testing**      | Vitest (309 tests), happy-dom, real Chrome via Puppeteer for scroll and layout behavior     |
| **CI / release** | GitHub Actions: gate on Node 20 and 22, tag-driven releases, npm publishing with provenance |
| **Production**   | Ubuntu VPS, nginx (SSE-aware proxy), systemd, Let's Encrypt, SSH deploys from Actions       |

---

## Architecture

Five packages, each usable on its own:

- **`ai-chat-core`**: `createChatHandler(config)` returns a function from a web `Request` to a streamed `Response`. Because it uses only web standards, the same handler runs in Node, Next.js, Astro, Hono or an edge runtime. It loads knowledge, builds the system prompt, runs guardrails, calls the model, executes tools and streams the reply.
- **`ai-chat-widget`**: the `<ai-chat>` element (17 KB gzipped). It works on any site (WordPress, static HTML, a framework app) and is themed with CSS variables.
- **`ai-chat-client`**: the streaming client the widget uses, for teams that want their own UI.
- **`ai-chat-react`**: a typed React wrapper around the widget.
- **`ai-chat-ingest`**: turns files a business owner uploads into knowledge documents and catalogs.

The wire format between widget and server is a small, versioned SSE protocol ([docs/protocol.md](protocol.md)) with events for text, UI cards, completion and errors, so other clients can be written against it.

---

## Key Features & Technical Highlights

### Answers grounded in the business's own data

Knowledge documents (company info, FAQs, policies) are loaded from config into a system prompt that is cached between requests, so repeated questions are cheap (cache reads bill at about a tenth). The product catalog stays out of the prompt: the model calls `search_catalog`, and the matches render as product cards with photo, price note and a "quote this" button. That keeps the prompt small however large the catalog grows.

### Tools that drive the interface

Besides search, the model can call UI tools: suggested replies (chips), a handoff card with WhatsApp and email buttons, and an inline lead form. The server runs a bounded two-round tool loop; the last round is forced to answer in text so a conversation never ends on a silent tool call.

### Lead capture that can't be forged

A submitted lead is sent to the business's webhook signed with HMAC-SHA256 and a timestamp. The receiving endpoint (a short PHP script on shared hosting, in Hisiverplast's case) verifies the signature before emailing sales, so nobody can post fake leads to it directly. The core exports `verifyLeadSignature` for Node receivers.

### Guardrails before any money is spent

Every check runs before the model is called, so a rejected request costs nothing: an origin allowlist (CORS), per-IP and global rate limits, concurrent-reply limits, body and conversation size caps, and a **daily token budget** weighted by what providers actually bill. Counters can live in Redis for multi-instance deployments. Each request logs one JSON line with a salted hash of the IP instead of the address.

### A widget that behaves on any page

Shadow DOM keeps the host site's CSS out and the widget's CSS in. Markdown from the model is rendered safely (no raw HTML, links restricted to http(s) and same-site paths). It supports Spanish and English, dark mode, keyboard navigation, a full-screen layout on phones, conversation persistence per tab, and remote configuration so the owner can change the greeting or starter questions without redeploying the site.

### Built to be operated by non-developers

Dashboard hooks (settings sources, form schemas, public settings) and a reference admin app let a business owner edit knowledge, settings and the catalog without code. A playground with a mock provider lets anyone try the widget without an API key.

---

## Engineering Stories

**Making OpenAI models call tools reliably.** With instructions phrased as "answer, then suggest replies", GPT models often answered and skipped the tool call. Rewriting the prompt to "call the tool first, then answer" and adding a second model round fixed the order; forcing `tool_choice: none` on the last round removed replies that ended on a tool call with no text.

**Packaging for pnpm 11.** Before an npm release the packages were installed from GitHub release URLs, and pnpm 11 blocks URL packages that depend on other URL packages. The fix was a dependency design, not a workaround: the packages refer to each other only as peer dependencies, and CI now fails any release where a package depends on a sibling.

**Scroll on a scroll-driven site.** Hisiverplast's site is built on Lenis smooth scrolling with GSAP ScrollTrigger, which listens to the mouse wheel on the whole window, so scrolling over the open chat moved the page instead of the conversation. Testing in real Chrome with the real Lenis (the old build as a control: page 399 px, chat 0 px) led to isolating wheel and touch events in the panel (chat 400 px, page 0 px). The same harness caught a regression unit tests missed: a CSS rule on the product-card row swallowed vertical scrolling. It was fixed in the next patch release, with a test that pins the rule.

**Loading last on a heavy page.** The site runs a 3D loader, so the widget loads only after the page is revealed and the browser is idle (measured: 13 ms after the reveal), with thumbnails trimmed from the existing product renders to 3–5 KB each.

---

## Production Deployment (hisiverplast.com)

- The marketing site stays a static Astro build on shared hosting; the chat server runs separately on a small VPS at `chat.hisiverplast.com`.
- nginx proxies with buffering off for streaming, and overwrites the client IP header so rate limits can't be bypassed. The Node service runs under systemd as an unprivileged user, with secrets in a root-owned environment file, HTTPS from Let's Encrypt and a firewall allowing only SSH and web traffic.
- GitHub Actions deploys both: the site over FTP, and the chat server over SSH with a restricted deploy user, only when the chat folder changes.
- Verified end to end in production: streaming answers with correct prices, foreign origins rejected with 403, and a signed test lead accepted by the hosting's endpoint.

---

## Results

- A reusable, documented library: one tag to embed, one function to serve, any brand through config.
- In production for a real manufacturer, answering product and price questions in Spanish and routing leads to sales.
- About 6,300 lines of source in five packages, 309 automated tests, CI on two Node versions, and versioned releases with changelogs.
- Costs are bounded by design: a daily token budget, prompt caching and rate limits mean a misbehaving client or a bot can't run up the bill.
