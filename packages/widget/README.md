# @franyerhiguerey/ai-chat-widget

The `<ai-chat>` Web Component: a chat launcher and panel for any website. It talks to your site's ai-chat endpoint (see [`docs/protocol.md`](../../docs/protocol.md)), so your API key stays on your server.

- **One file, no dependencies.** About 13 KB gzipped, with Shadow DOM so it never clashes with the site's CSS.
- **White-label.** It takes the brand color, corner radius and font from CSS custom properties, and the name, avatar, greeting and starter questions from attributes.
- **Built for streaming.** The typing indicator appears instantly. Text streams in once per frame, and the visitor can stop it or retry it.
- **Safe markdown.** Text only enters the DOM as text nodes. Links work only for `http(s)`, `mailto` and `tel`.
- **Accessible.** Keyboard and screen reader friendly, with visible focus. Reduced motion is respected.
- **Bilingual.** Spanish and English UI, with dark mode, a desktop panel and full screen on mobile.

## Install

With a bundler:

```bash
pnpm add @franyerhiguerey/ai-chat-widget
```

```ts
import '@franyerhiguerey/ai-chat-widget'; // registers <ai-chat>
```

Or with a plain script tag, using `dist/ai-chat.global.js`:

```html
<script src="/ai-chat.global.js" defer></script>
```

For React, use [`@franyerhiguerey/ai-chat-react`](../react).

## Use

```html
<ai-chat
  endpoint="/api/chat"
  name="Your Brand"
  avatar="/logo.svg"
  lang="es"
  config='{"starters": ["¿Qué ofrecen?", "¿Cuánto cuesta?"]}'
></ai-chat>
```

| Attribute   | Default                               | Notes                                                    |
| ----------- | ------------------------------------- | -------------------------------------------------------- |
| `endpoint`  | `/api/chat`                           | Your ai-chat endpoint                                    |
| `name`      | "Asistente" / "Assistant"             | Header, welcome screen, screen reader labels             |
| `avatar`    | initials of `name` on the brand color | Image URL                                                |
| `lang`      | `<html lang>`, then the browser       | `es` or `en`. Sets the UI text and the server's errors   |
| `theme`     | `auto`                                | `auto`, `light` or `dark`                                |
| `status`    | "Responde al instante"                | The line under the name                                  |
| `open`      | closed                                | Present means open. Also `show()`, `hide()`, `toggle()`  |
| `max-chars` | `2000`                                | Keep it equal to the server's `limits.maxMessageChars`   |
| `config`    |                                       | JSON for the options below. Or set the `config` property |

### `config`

```ts
chat.config = {
  greeting: { es: '¡Hola! ¿En qué te ayudo?', en: 'Hi! How can I help?' },
  starters: {
    es: [{ label: '¿Cuánto tarda la entrega?', icon: 'truck' }, '¿Dónde están?'],
    en: [{ label: 'How long does delivery take?', icon: 'truck' }, 'Where are you?'],
  },
  handoff: { href: 'https://wa.me/584121234567', label: { es: 'Escríbenos por WhatsApp' } },
  teaser: { es: '👋 ¿Preguntas? Te ayudo.', en: '👋 Questions? I can help.' },
};
```

Every text takes either one string or one per language. Starter icons: `chat`, `package`, `grid`, `truck`, `receipt`, `help`, `clock`, `pin`, `tag`, `mail`. The handoff link only accepts `https:`, `mailto:` and `tel:` URLs.

## Theme

Set the tokens on the element (or any ancestor):

```css
ai-chat {
  --chat-brand: #c2410c;
  --chat-radius: 20px;
  --chat-font: 'Nunito', system-ui, sans-serif; /* defaults to the page's font */
}
```

| Token              | Light default               | Dark default |
| ------------------ | --------------------------- | ------------ |
| `--chat-brand`     | `#0F6BDC`                   | `#4C9BFF`    |
| `--chat-on-brand`  | white or black, by contrast | same rule    |
| `--chat-surface`   | `#FFFFFF`                   | `#171A21`    |
| `--chat-surface-2` | `#F4F6F9`                   | `#1F232C`    |
| `--chat-text`      | `#16181D`                   | `#E7E9EE`    |
| `--chat-muted`     | `#5F6673`                   | `#9AA1AD`    |
| `--chat-border`    | `#E2E5EA`                   | `#2A2F3A`    |
| `--chat-success`   | `#127A3E`                   | `#5BD08A`    |
| `--chat-danger`    | `#B42318`                   | `#FF8A80`    |
| `--chat-radius`    | `16px`                      | same         |
| `--chat-font`      | inherited                   | same         |
| `--chat-z-index`   | `2147483000`                | same         |

In dark mode, a custom `--chat-brand` is kept unless you also set `--chat-brand-dark`. Set it when your brand is dark, like navy, so it stays readable on dark surfaces. Every color token has a `-dark` variant (`--chat-surface-dark`, …). `::part(launcher)`, `::part(panel)`, `::part(header)` and `::part(teaser)` are exposed for anything else.

## Events

| Event             | `detail`                        |
| ----------------- | ------------------------------- |
| `ai-chat:open`    |                                 |
| `ai-chat:close`   |                                 |
| `ai-chat:message` | `{ message }`, a finished reply |
| `ai-chat:error`   | `{ code, message }`             |

Methods: `show()`, `hide()`, `toggle()`, `send(text)`, `reset()`.

## Behavior

- **Persistence:** the conversation and open state live in `sessionStorage` per endpoint, so they survive navigation but not a closed tab. Without storage (privacy mode, sandboxed iframes) everything still works in memory.
- **Stop:** the visitor keeps the partial reply. If nothing had arrived, the question goes back into the input.
- **Errors:** they show as a bubble with Retry. If the conversation is too long, the button starts a new one instead.
