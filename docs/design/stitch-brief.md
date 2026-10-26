# Stitch brief: ai-chat widget

The design brief for the chat widget, to paste into [Google Stitch](https://stitch.withgoogle.com). The design comes back as the input for Milestone 3, where it becomes the `<ai-chat>` Web Component.

**This is a template, not a site.** One widget is installed on many different websites, each configured with its own name, avatar, colors, starter questions and features. The design must work for any business, and never look like it belongs to one.

## How to use this brief

1. Create one Stitch project. Start with the **master prompt** (section 7), mobile first.
2. Use the **screen prompts** (section 8) one at a time, in the same project, so every screen keeps the same style.
3. Finish with the **brand-swap screens**: the same widget in three unrelated businesses. They prove the design is a template.
4. Share the project back through the Stitch MCP server. Tell me about any color or spacing changes so the token table (section 4) stays in sync.

## 1. What it is

A chat assistant that any business adds to its website. It answers visitors from that business's own information (FAQ, services, products, policies) and hands them to a human when needed.

The owner sets everything in a config file:

| Setting                        | Changes                                                                    |
| ------------------------------ | -------------------------------------------------------------------------- |
| Name and avatar                | Header, welcome screen, first bubble of each reply                         |
| Brand tokens                   | Color, radius and font (section 4)                                         |
| Greeting and starter questions | Welcome screen and launcher teaser                                         |
| Languages                      | UI text (English and Spanish to start)                                     |
| Handoff channel                | WhatsApp, email, or none: changes the handoff card and the header shortcut |
| Lead capture                   | On or off: shows or hides the inline form                                  |
| Product catalog                | Optional: shows or hides product cards                                     |

The layout and behavior never change. Only content and tokens do. The design must look complete in every combination, for example with no catalog, no WhatsApp and no lead form.

## 2. What should make it surprising

1. **Instant and alive.** The typing indicator appears the moment you send, and text streams in smoothly with no layout jumps.
2. **Answers, not walls of text.** Short replies with bold key facts and short lists. Items appear as visual cards.
3. **Always a next step.** Every answer ends with 2 or 3 tappable suggestion chips.
4. **A human is one tap away.** A handoff card arrives with the conversation summary already written.
5. **Leads without forms.** A short inline form appears inside the chat when the visitor wants to be contacted.
6. **Native to every site.** It takes the site's color, radius and font, so it never looks like a third-party widget pasted on top.

## 3. Personality

Helpful, fast, trustworthy. Calm and neutral, because it has to fit a bakery, a law firm or a factory. No mascots, no illustrations, no decorative color. Generous white space and a clear hierarchy: one brand color plus neutrals.

## 4. Design tokens

Use these tokens for every color and every corner. Each site overrides them. The defaults are below.

| Token              | Default (light)                              | Default (dark) | Used for                                               |
| ------------------ | -------------------------------------------- | -------------- | ------------------------------------------------------ |
| `--chat-brand`     | `#0F6BDC`                                    | `#4C9BFF`      | Launcher, send button, user bubbles, links, focus ring |
| `--chat-on-brand`  | `#FFFFFF`                                    | `#0B0D11`      | Text and icons on brand                                |
| `--chat-surface`   | `#FFFFFF`                                    | `#171A21`      | Panel background                                       |
| `--chat-surface-2` | `#F4F6F9`                                    | `#1F232C`      | Assistant bubbles, cards, input                        |
| `--chat-text`      | `#16181D`                                    | `#E7E9EE`      | Main text                                              |
| `--chat-muted`     | `#5F6673`                                    | `#9AA1AD`      | Hints, captions, notices                               |
| `--chat-border`    | `#E2E5EA`                                    | `#2A2F3A`      | Dividers, card borders                                 |
| `--chat-success`   | `#127A3E`                                    | `#5BD08A`      | Lead sent, WhatsApp button                             |
| `--chat-danger`    | `#B42318`                                    | `#FF8A80`      | Errors                                                 |
| `--chat-radius`    | `16px`                                       | same           | Panel, bubbles, cards (chips are always pill-shaped)   |
| `--chat-font`      | the site's font, falling back to `system-ui` | same           | All text                                               |

- **Type:** 15px body with a 1.5 line height; 13px captions; 17px header title.
- **Spacing:** a 4px grid.
- **Brand color:** must work whether the brand is light (yellow) or dark (navy). Text on brand uses `--chat-on-brand`.
- **In the widget (M3):** `--chat-on-brand` defaults to white or black, whichever reads better on the brand. Every color has a `-dark` override (`--chat-brand-dark`, …) for sites whose brand is too dark for dark mode. The full list is in [packages/widget/README.md](../../packages/widget/README.md#theme).

## 5. Layout and components

**Layout**

- **Launcher:** a 56px circle at the bottom right, 20px from the edges. An optional teaser bubble beside it shows the greeting, with a close ×.
- **Desktop panel:** 380×640px (max-height 80vh), above the launcher, with a soft shadow.
- **Mobile:** full screen, respecting safe areas, with the input kept above the keyboard.
- **Panel structure:** header (avatar, name, status, optional handoff shortcut, close), scrollable messages, chips row, input bar (auto-growing field, send button, small "AI-powered" note).

**Components**

1. Launcher (closed, hover, open) and teaser.
2. Header. The avatar is a logo, or initials on brand color when there is no logo.
3. **Assistant bubble** (`surface-2`, left), with the avatar on the first bubble of a group. It renders markdown: bold, lists, links.
4. **User bubble** (brand, right).
5. Typing indicator (three dots).
6. **Streaming state**: the bubble grows as text arrives, and the send button turns into **Stop**.
7. **Suggestion chips**: pills with a brand outline.
8. **Item card**: image (4:3, optional), title, 1–2 facts, CTA. Plus a carousel with peek. It must still look good with no image.
9. **Handoff card**: a WhatsApp variant and an email variant, each with a summary preview and a full-width button.
10. **Inline lead form card**: name, phone or email, and a "what do you need" field prefilled from the chat. States: default, error, sending, success.
11. **Notices** (centered, muted): "Reply stopped", "Reply cut off".
12. **Error bubble** with Retry.
13. **Welcome screen**: avatar, greeting, one line about what it can help with, 3–4 starter chips, and a "Talk to a person" link.

## 6. Rules

- **Accessibility:** WCAG AA (4.5:1 for text) in light and dark mode, 44px touch targets, a visible 2px focus ring, and errors that don't rely on color alone.
- **Motion:** bubbles fade and slide up 4px over about 150ms, the panel scales and fades over about 200ms, and the dots pulse. Everything turns off with reduced motion.
- **Text:** at least 13px. Long words, URLs and longer translations (Spanish runs about 20% longer) must wrap without breaking the layout.
- **Technical constraints** (it ships as a Web Component in Shadow DOM):
  - Plain HTML/CSS with no UI kit.
  - Inline SVG outline icons.
  - Images only for the avatar and item photos.
  - No global styles.

## 7. Master prompt

> Design a reusable chat assistant widget that any business can embed on its website. It is a white-label template: the business name, logo, brand color, corner radius, font, greeting and starter questions all come from configuration, so the design must be neutral and must not look tied to any industry. Use the placeholder brand "Your Brand" with an initials avatar "YB". Mobile-first, UI in English.
>
> Style: clean, calm, trustworthy, modern SaaS quality. Neutral surfaces with a single brand color (#0F6BDC) used sparingly, 16px corner radius, system font, 15px body text, generous whitespace. No mascots, illustrations or decorative colors.
>
> It opens from a round launcher at the bottom right into a full-screen chat on mobile, or a 380×640 floating panel on desktop. The panel has:
>
> - a header with the avatar, the name "Your Brand", the status "Replies instantly", and a close icon;
> - assistant bubbles on a light grey surface on the left, and user bubbles in the brand color on the right;
> - a row of pill-shaped suggestion chips above the input;
> - an input bar with an auto-growing text field and a round send button;
> - a tiny "AI-powered" note.
>
> Replies use bold key facts and short bullet lists. The assistant can also show item cards (optional image, title, two facts, a button), a handoff card that continues the conversation on WhatsApp or by email, and a short inline contact form.
>
> WCAG AA contrast, 44px touch targets, outline icons.

## 8. Screen prompts

Use them in order, one per generation.

**Core states**

1. **Welcome:** "Welcome state: empty conversation with a large initials avatar, the greeting 'Hi! I'm the Your Brand assistant. Ask me about our services, prices, hours or anything else.', 4 starter chips ('What do you offer?', 'How much does it cost?', 'Where are you located?', 'I want to be contacted'), and a small 'Talk to a person' link."
2. **Streaming:** "Streaming state: the visitor asked 'How long does delivery take?'. The assistant's reply is half written, with a bold '3 to 5 business days' and a 2-item list. The send button has become a square Stop button."
3. **Chips:** "Same conversation, reply finished, followed by 3 suggestion chips: 'Do you deliver to my area?', 'What are the payment options?', 'Talk to a person'."
4. **Error:** "Error state: an assistant bubble in a soft red, 'The connection was lost. Check your internet and try again.', with a 'Retry' button. Plus a variant, 'We're getting a lot of questions. Please try again in a few seconds.'"
5. **Launcher:** "Closed state on a sample website: the round launcher at the bottom right with a small teaser bubble '👋 Questions? I can help.' and a close ×."

**Optional features** (each one can be turned off per site)

6. **Item cards:** "The assistant says 'Here are a few options:' followed by a horizontal carousel of 3 item cards. Each has a 4:3 image placeholder, a title ('Option name'), one line of two short facts, and a 'Learn more' button. The next card peeks in. Show a second version where the cards have no image."
7. **Handoff:** "A handoff card: title 'Talk to a person', a quoted preview of a prefilled message summarizing the visitor's request, and a full-width green 'Continue on WhatsApp' button with the WhatsApp icon. Also an email variant with a 'Send email' button in the brand color. Muted note: 'Mon–Fri, 9:00–17:00'."
8. **Lead form:** "An inline contact form card inside the chat: title 'Want us to contact you?', fields Name, Phone or email, and 'What do you need?' (prefilled from the conversation), plus a 'Send' button. Then the same card with an error under the email field, and the success state 'Done! We'll get back to you within 1 business day.' with a check icon."
9. **Minimal setup:** "The answer-with-chips screen for a site with no catalog, no WhatsApp and no lead form: no handoff shortcut in the header, and only answer and chips. It must still feel complete."

**Desktop and themes**

10. **Desktop:** "Desktop: the 380×640 floating panel open above the launcher on a sample website, showing the item cards conversation."
11. **Dark mode:** "Dark mode versions of the streaming and item card screens, with brand color #4C9BFF on dark surfaces."

**Brand-swap screens** (these prove it's a template)

12. **Three brands:** "Show the answer-with-chips screen three times, side by side, configured for three unrelated businesses:
    - a bakery: brand #C2410C, 20px radius, a rounded friendly font, logo avatar, starter chips about orders and opening hours;
    - a law firm: brand #1E3A5F, 4px radius, a serif font, initials avatar, chips about consultations and fees;
    - a software company: brand #7C3AED, 12px radius, a geometric sans font, chips about plans and integrations.

    Only tokens and content change; the layout is identical."

13. **Spanish:** "The welcome and chips screens with the UI in Spanish ('¡Hola! Soy el asistente de Your Brand…', 'Hablar con una persona', 'Reintentar'), checking that the longer text still fits."

## 9. Hand-off for Milestone 3

Milestone 3 rebuilds these screens as one Web Component. Every value that differs between the brand-swap screens becomes a token or a config field, and everything else is fixed. The Stitch output is the visual reference, not code to copy as is.
