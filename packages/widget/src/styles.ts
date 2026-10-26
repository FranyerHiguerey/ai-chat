/**
 * Shadow DOM styles. Sites theme the widget with the public `--chat-*` custom
 * properties (they pierce the shadow root); the private `--c-*` ones resolve
 * them against the defaults from docs/design/stitch-brief.md.
 */
export const styles = /* css */ `
:host {
  --c-brand: var(--chat-brand, #0f6bdc);
  --c-surface: var(--chat-surface, #ffffff);
  --c-surface-2: var(--chat-surface-2, #f4f6f9);
  --c-text: var(--chat-text, #16181d);
  --c-muted: var(--chat-muted, #5f6673);
  --c-border: var(--chat-border, #e2e5ea);
  --c-success: var(--chat-success, #127a3e);
  --c-danger: var(--chat-danger, #b42318);
  --c-on-brand: var(--chat-on-brand, var(--c-auto-on-brand, #ffffff));
  --c-radius: var(--chat-radius, 16px);
  --c-shadow: 0 12px 32px -4px rgb(17 24 39 / 0.14), 0 4px 12px -2px rgb(17 24 39 / 0.06);
  --c-z: var(--chat-z-index, 2147483000);
  color-scheme: light;
  font-family: var(--chat-font);
}

/* Readable text on any brand color: white on dark brands, black on light ones. */
@supports (color: oklch(from red l c h)) {
  :host {
    --c-auto-on-brand: oklch(from var(--c-brand) clamp(0, (0.6 - l) * 1000, 1) 0 0);
  }
}

${darkTokens(':host([theme="dark"])')}
@media (prefers-color-scheme: dark) {
  ${darkTokens(':host(:not([theme="light"]))')}
}

*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }

.root {
  font-size: 15px;
  line-height: 1.5;
  color: var(--c-text);
  letter-spacing: normal;
  text-align: start;
  -webkit-font-smoothing: antialiased;
}

button, input, textarea { font: inherit; color: inherit; }
button { background: none; border: 0; padding: 0; margin: 0; cursor: pointer; }
a { color: inherit; }
:focus-visible { outline: 2px solid var(--c-brand); outline-offset: 2px; }

.sr-only {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* Launcher and teaser */
.launcher {
  position: fixed; right: 20px; bottom: 20px; z-index: var(--c-z);
  width: 56px; height: 56px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--c-brand); color: var(--c-on-brand);
  box-shadow: 0 4px 14px -2px color-mix(in srgb, var(--c-brand) 45%, transparent);
  transition: transform 150ms ease;
}
.launcher:hover { transform: scale(1.05); }
.launcher:active { transform: scale(0.97); }
.launcher svg { width: 26px; height: 26px; }

.teaser {
  position: fixed; right: 20px; bottom: 88px; z-index: var(--c-z);
  max-width: min(280px, calc(100vw - 40px));
  display: flex; align-items: flex-start; gap: 4px;
  padding: 4px 4px 4px 14px;
  background: var(--c-surface); color: var(--c-text);
  border: 1px solid var(--c-border); border-radius: var(--c-radius);
  box-shadow: var(--c-shadow);
  animation: rise 200ms ease-out 600ms both;
}
.teaser__text { padding: 8px 0; text-align: start; flex: 1; }
.teaser__close { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: var(--c-muted); }
.teaser__close:hover { background: var(--c-surface-2); }

/* Panel */
.panel {
  position: fixed; right: 20px; bottom: 92px; z-index: var(--c-z);
  width: 380px; height: min(640px, 80vh, calc(100vh - 112px));
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--c-surface);
  border: 1px solid var(--c-border); border-radius: var(--c-radius);
  box-shadow: var(--c-shadow);
  transform-origin: bottom right;
  animation: panel-in 200ms ease-out;
}
.panel:focus { outline: none; }

@media (max-width: 639px) {
  .panel {
    inset: 0; width: 100%; height: 100dvh;
    border: 0; border-radius: 0; box-shadow: none;
    padding-top: env(safe-area-inset-top);
    animation-name: sheet-in;
  }
  .root[data-open] .launcher, .root[data-open] .teaser { display: none; }
}

.header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 8px 12px 16px;
  border-bottom: 1px solid var(--c-border);
}
.header__titles { flex: 1; min-width: 0; }
.header__title { margin: 0; font-size: 17px; font-weight: 600; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header__status { margin: 0; font-size: 13px; color: var(--c-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.header__status::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-inline-end: 6px; border-radius: 50%; background: var(--c-success); vertical-align: 1px; }
.icon-btn {
  flex: none; width: 44px; height: 44px; border-radius: 12px;
  display: grid; place-items: center; color: var(--c-muted); text-decoration: none;
}
.icon-btn:hover { background: var(--c-surface-2); color: var(--c-text); }

.avatar {
  flex: none; display: grid; place-items: center; overflow: hidden;
  border-radius: 50%; background: var(--c-brand); color: var(--c-on-brand);
  font-weight: 600; user-select: none;
}
.avatar img { width: 100%; height: 100%; object-fit: cover; background: var(--c-surface); }
.avatar--sm { width: 28px; height: 28px; font-size: 12px; }
.avatar--md { width: 40px; height: 40px; font-size: 15px; }
.avatar--lg { width: 64px; height: 64px; font-size: 24px; border-radius: var(--c-radius); }

/* Conversation */
.body {
  flex: 1; overflow-y: auto; overscroll-behavior: contain;
  padding: 16px; scroll-padding-bottom: 16px;
}
.log { display: flex; flex-direction: column; gap: 12px; }
.slot { display: contents; }
.welcome__starters { width: 100%; }

.welcome { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 12px 0 4px; }
.welcome__title { margin: 14px 0 4px; font-size: 17px; font-weight: 600; }
.welcome__text { margin: 0 0 20px; color: var(--c-muted); max-width: 30em; }
.starters { list-style: none; margin: 0; padding: 0; width: 100%; display: flex; flex-direction: column; gap: 8px; }
.starter {
  width: 100%; min-height: 52px; padding: 8px 12px;
  display: flex; align-items: center; gap: 12px; text-align: start;
  background: var(--c-surface); border: 1px solid var(--c-border); border-radius: calc(var(--c-radius) * 0.75);
  transition: border-color 120ms ease, background 120ms ease;
}
.starter:hover { border-color: var(--c-brand); background: var(--c-surface-2); }
.starter__icon {
  flex: none; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center;
  color: var(--c-brand); background: color-mix(in srgb, var(--c-brand) 10%, var(--c-surface));
}
.starter__label { flex: 1; font-weight: 500; overflow-wrap: anywhere; }
.starter__chevron { flex: none; color: var(--c-muted); display: grid; }
.handoff-link {
  display: inline-flex; align-items: center; gap: 6px; min-height: 44px; margin-top: 12px; padding: 0 12px;
  color: var(--c-success); font-weight: 600; text-decoration: none; border-radius: 12px;
}
.handoff-link:hover { text-decoration: underline; }

.msg { display: flex; align-items: flex-end; gap: 8px; animation: rise 150ms ease-out; }
.msg__body { min-width: 0; max-width: 85%; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.msg--user { justify-content: flex-end; }
.msg--user .msg__body { align-items: flex-end; }
.bubble {
  padding: 10px 14px; border-radius: var(--c-radius);
  overflow-wrap: anywhere; min-width: 0; max-width: 100%;
}
.msg--user .bubble {
  background: var(--c-brand); color: var(--c-on-brand);
  border-end-end-radius: 4px; white-space: pre-wrap;
}
.msg--assistant .bubble {
  background: var(--c-surface-2); border: 1px solid var(--c-border);
  border-end-start-radius: 4px;
}
.bubble p { margin: 0 0 8px; }
.bubble ul, .bubble ol { margin: 0 0 8px; padding-inline-start: 20px; }
.bubble li + li { margin-top: 2px; }
.bubble > :last-child { margin-bottom: 0; }
.bubble strong { font-weight: 600; }
.bubble a { color: var(--c-brand); text-decoration: underline; text-underline-offset: 2px; }
.bubble code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em;
  padding: 1px 4px; border-radius: 4px; background: color-mix(in srgb, var(--c-text) 8%, transparent);
}
.bubble pre { margin: 0 0 8px; padding: 10px; overflow-x: auto; border-radius: 8px; background: color-mix(in srgb, var(--c-text) 6%, transparent); }
.bubble pre code { padding: 0; background: none; }

.msg-group { display: flex; flex-direction: column; gap: 6px; }
.notice { margin: 0; text-align: center; font-size: 13px; color: var(--c-muted); }

.dots { display: inline-flex; gap: 4px; padding: 6px 2px; }
.dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--c-muted); animation: pulse 1.2s infinite ease-in-out; }
.dots i:nth-child(2) { animation-delay: 0.15s; }
.dots i:nth-child(3) { animation-delay: 0.3s; }
.caret {
  display: inline-block; width: 0.5em; height: 1.1em; margin-inline-start: 2px; vertical-align: text-bottom;
  background: var(--c-brand); border-radius: 1px; animation: blink 1s steps(2, start) infinite;
}

.msg--error {
  align-items: flex-start; padding: 12px 14px; border-radius: var(--c-radius);
  background: color-mix(in srgb, var(--c-danger) 9%, var(--c-surface));
  border: 1px solid color-mix(in srgb, var(--c-danger) 35%, var(--c-surface));
}
.msg--error .msg__body { max-width: 100%; }
.msg--error p { margin: 0; }
.msg--error__title { font-weight: 600; color: var(--c-danger); }
.msg--error__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.msg--error__icon { color: var(--c-danger); display: grid; padding-top: 2px; }

.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 40px; padding: 0 14px; border-radius: 10px; font-weight: 600; font-size: 14px;
}
.btn--ghost { background: var(--c-surface); border: 1px solid var(--c-border); }
.btn--ghost:hover { border-color: var(--c-brand); color: var(--c-brand); }
.btn--primary { background: var(--c-brand); color: var(--c-on-brand); }
.btn--primary:hover { filter: brightness(1.08); }
.btn--link { color: var(--c-success); text-decoration: none; padding: 0 8px; }
.btn--link:hover { text-decoration: underline; }
.composer textarea:disabled { cursor: not-allowed; }

/* Chips, input and footer */
.chips {
  display: flex; gap: 8px; overflow-x: auto; padding: 8px 12px 0; scrollbar-width: none;
  mask-image: linear-gradient(to right, transparent, #000 12px, #000 calc(100% - 24px), transparent);
}
.chips::-webkit-scrollbar { display: none; }
.chip {
  flex: none; min-height: 40px; padding: 0 14px; border-radius: 999px; font-size: 14px; white-space: nowrap;
  border: 1px solid color-mix(in srgb, var(--c-brand) 45%, var(--c-border)); color: var(--c-text); background: var(--c-surface);
}
.chip:hover { border-color: var(--c-brand); color: var(--c-brand); }

.composer {
  display: flex; align-items: flex-end; gap: 4px; margin: 12px 12px 0; padding: 3px;
  background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.composer:focus-within {
  border-color: var(--c-brand);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-brand) 18%, transparent);
}
.composer textarea {
  flex: 1; min-width: 0; resize: none; border: 0; outline: none; background: transparent;
  padding: 8px 8px 8px 10px; font-size: 16px; line-height: 22px; max-height: 132px; overflow-y: auto;
}
.composer textarea::placeholder { color: var(--c-muted); }
.send {
  flex: none; width: 38px; height: 38px; border-radius: 10px;
  display: grid; place-items: center; background: var(--c-brand); color: var(--c-on-brand);
  transition: opacity 120ms ease;
}
.send[aria-disabled="true"] { opacity: 0.45; cursor: default; }
.footer {
  margin: 0; padding: 6px 12px calc(8px + env(safe-area-inset-bottom));
  display: flex; align-items: center; justify-content: center; gap: 4px;
  font-size: 13px; color: var(--c-muted);
}

@keyframes panel-in { from { opacity: 0; transform: translateY(8px) scale(0.97); } }
@keyframes sheet-in { from { opacity: 0; transform: translateY(16px); } }
@keyframes rise { from { opacity: 0; transform: translateY(4px); } }
@keyframes pulse { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.85); } 40% { opacity: 1; transform: scale(1); } }
@keyframes blink { to { visibility: hidden; } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;

function darkTokens(selector: string): string {
  return `${selector} {
    --c-brand: var(--chat-brand-dark, var(--chat-brand, #4c9bff));
    --c-on-brand: var(--chat-on-brand-dark, var(--chat-on-brand, var(--c-auto-on-brand, #0b0d11)));
    --c-surface: var(--chat-surface-dark, #171a21);
    --c-surface-2: var(--chat-surface-2-dark, #1f232c);
    --c-text: var(--chat-text-dark, #e7e9ee);
    --c-muted: var(--chat-muted-dark, #9aa1ad);
    --c-border: var(--chat-border-dark, #2a2f3a);
    --c-success: var(--chat-success-dark, #5bd08a);
    --c-danger: var(--chat-danger-dark, #ff8a80);
    --c-shadow: 0 12px 32px -4px rgb(0 0 0 / 0.5), 0 4px 12px -2px rgb(0 0 0 / 0.3);
    color-scheme: dark;
  }`;
}
