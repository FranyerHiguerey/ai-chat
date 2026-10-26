/** Builders for the parts of the panel that depend on content. */
import type { Message, Starter } from '../types.js';
import { textOf } from '../types.js';
import type { UiStrings } from '../i18n.js';
import { renderMarkdown } from '../markdown.js';
import { h, srOnly } from './dom.js';
import { icon, isIconName } from './icons.js';

export interface ViewContext {
  name: string;
  avatar?: string;
  strings: UiStrings;
}

export function initials(name: string): string {
  const words = name.split(/\s+/).filter((word) => /^[\p{L}\p{N}]/u.test(word));
  const letters = words.length > 1 ? `${words[0]?.[0]}${words[1]?.[0]}` : (words[0]?.[0] ?? '?');
  return letters.toUpperCase();
}

/** The site's logo, or its initials on the brand color when there is none or it fails to load. */
export function avatar(ctx: ViewContext, size: 'sm' | 'md' | 'lg'): HTMLElement {
  const box = h('span', { class: `avatar avatar--${size}`, 'aria-hidden': 'true' });
  const fallback = () => box.replaceChildren(initials(ctx.name));
  if (ctx.avatar) {
    const img = h('img', { src: ctx.avatar, alt: '', decoding: 'async' });
    img.addEventListener('error', fallback, { once: true });
    box.append(img);
  } else {
    fallback();
  }
  return box;
}

export function messageView(message: Message, ctx: ViewContext): HTMLElement {
  const isUser = message.role === 'user';
  const bubble = h('div', { class: 'bubble' });
  if (isUser) bubble.textContent = textOf(message);
  else bubble.append(renderMarkdown(textOf(message)));

  const row = h(
    'div',
    { class: `msg msg--${message.role}`, 'data-id': message.id },
    !isUser && avatar(ctx, 'sm'),
    h('div', { class: 'msg__body' }, srOnly(`${isUser ? ctx.strings.you : ctx.name}: `), bubble),
  );
  if (message.notice) {
    const text = message.notice === 'stopped' ? ctx.strings.stopped : ctx.strings.cutOff;
    return h(
      'div',
      { class: 'msg-group', 'data-id': message.id },
      row,
      h('p', { class: 'notice' }, text),
    );
  }
  return row;
}

/** The in-progress reply: typing dots until text arrives, then the streamed markdown. */
export function draftView(ctx: ViewContext): { root: HTMLElement; bubble: HTMLElement } {
  const bubble = h('div', { class: 'bubble' });
  const root = h(
    'div',
    { class: 'msg msg--assistant msg--draft' },
    avatar(ctx, 'sm'),
    h('div', { class: 'msg__body' }, srOnly(`${ctx.name}: `), bubble),
  );
  return { root, bubble };
}

export function renderDraft(bubble: HTMLElement, text: string, strings: UiStrings): void {
  if (!text) {
    bubble.replaceChildren(
      h('span', { class: 'dots', role: 'status' }, h('i'), h('i'), h('i'), srOnly(strings.typing)),
    );
    return;
  }
  bubble.replaceChildren(renderMarkdown(text));
  // The caret goes after the last text, inside a list's last item or a trailing bold.
  let tail: Element = bubble;
  while (
    tail.lastChild instanceof Element &&
    !['BR', 'CODE', 'A', 'PRE'].includes(tail.lastChild.tagName)
  ) {
    tail = tail.lastChild;
  }
  tail.appendChild(h('span', { class: 'caret', 'aria-hidden': 'true' }));
}

export interface Handoff {
  href: string;
  label: string;
  /** Opens in a new tab (http links); announced to screen readers. */
  newTab?: string;
}

export interface ErrorViewProps {
  code: string;
  title: string;
  text: string;
  /** Retry, or New conversation (primary) when retrying can't help. */
  action?: { label: string; primary?: boolean; run: () => void };
  /** The site's human contact, offered when the assistant fails. */
  handoff?: Handoff;
}

export function errorView({ code, title, text, action, handoff }: ErrorViewProps): HTMLElement {
  const actions = h('div', { class: 'msg--error__actions' });
  if (action) {
    const button = h(
      'button',
      { type: 'button', class: `btn ${action.primary ? 'btn--primary' : 'btn--ghost'}` },
      icon(action.primary ? 'chat' : 'restart', 16),
      action.label,
    );
    button.addEventListener('click', action.run);
    actions.append(button);
  }
  if (handoff) actions.append(handoffLink(handoff, 'btn btn--link'));
  return h(
    'div',
    { class: 'msg msg--error', role: 'alert', 'data-code': code },
    h('span', { class: 'msg--error__icon' }, icon('alert', 18)),
    h(
      'div',
      { class: 'msg__body' },
      h('p', { class: 'msg--error__title' }, title),
      h('p', {}, text),
      actions.childElementCount > 0 && actions,
    ),
  );
}

export function handoffLink(handoff: Handoff, className: string): HTMLAnchorElement {
  const link = h(
    'a',
    { class: className, href: handoff.href },
    icon('headset', 18),
    handoff.label,
    ...(handoff.newTab ? [icon('external', 16), srOnly(` ${handoff.newTab}`)] : []),
  );
  if (handoff.newTab) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  return link;
}

export function startersView(
  starters: Starter[],
  onPick: (starter: Starter) => void,
): HTMLUListElement {
  return h(
    'ul',
    { class: 'starters' },
    ...starters.map((starter) => {
      const button = h(
        'button',
        { type: 'button', class: 'starter' },
        h(
          'span',
          { class: 'starter__icon' },
          icon(isIconName(starter.icon) ? starter.icon : 'chat', 18),
        ),
        h('span', { class: 'starter__label' }, starter.label),
        h('span', { class: 'starter__chevron' }, icon('chevron', 16)),
      );
      button.addEventListener('click', () => onPick(starter));
      return h('li', {}, button);
    }),
  );
}

/** Reply chips above the input. Empty until the server sends suggestions (M4). */
export function chipsView(items: string[], onPick: (text: string) => void): HTMLElement[] {
  return items.map((text) => {
    const chip = h('button', { type: 'button', class: 'chip' }, text);
    chip.addEventListener('click', () => onPick(text));
    return chip;
  });
}
