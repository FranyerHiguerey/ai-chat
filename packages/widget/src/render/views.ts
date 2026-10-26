/** Builders for the parts of the panel that depend on content. */
import type { HandoffChannel, LeadFields, SubmitLeadResult } from '@franyerhiguerey/ai-chat-client';
import type { Message, MessagePart, Starter } from '../types.js';
import { textOf } from '../types.js';
import { safeUrl } from '../markdown.js';
import type { UiStrings } from '../i18n.js';
import { renderMarkdown } from '../markdown.js';
import { h, srOnly } from './dom.js';
import { icon, isIconName } from './icons.js';

export interface ViewContext {
  name: string;
  avatar?: string;
  strings: UiStrings;
  /** Sends a lead form shown under a message. */
  submitLead?: (messageId: string, lead: LeadFields) => Promise<SubmitLeadResult>;
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
  const text = textOf(message);
  const bubble = text.trim() ? h('div', { class: 'bubble' }) : undefined;
  if (bubble && isUser) bubble.textContent = text;
  else if (bubble) bubble.append(renderMarkdown(text));
  const cards = isUser ? [] : message.parts.map((part) => cardView(part, message.id, ctx));

  const row = h(
    'div',
    { class: `msg msg--${message.role}`, 'data-id': message.id },
    !isUser && avatar(ctx, 'sm'),
    h(
      'div',
      { class: 'msg__body' },
      srOnly(`${isUser ? ctx.strings.you : ctx.name}: `),
      bubble,
      ...cards,
    ),
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

function cardView(part: MessagePart, messageId: string, ctx: ViewContext): HTMLElement | undefined {
  if (part.type === 'handoff') return handoffCard(part.channels, ctx);
  if (part.type === 'lead_form') {
    return part.status === 'sent' ? leadSent(ctx) : leadForm(part.reason, messageId, ctx);
  }
  return undefined;
}

/** Buttons to reach the team. Links are built by the server and checked again here. */
export function handoffCard(channels: HandoffChannel[], ctx: ViewContext): HTMLElement | undefined {
  const { handoff, newTab } = ctx.strings;
  const links = channels.flatMap((channel) => {
    const href = safeUrl(channel.href);
    if (!href) return [];
    const isWhatsapp = channel.type === 'whatsapp';
    const link = h(
      'a',
      { class: `btn ${isWhatsapp ? 'btn--whatsapp' : 'btn--ghost'}`, href },
      icon(isWhatsapp ? 'chat' : 'mail', 18),
      isWhatsapp ? handoff.whatsapp : handoff.email,
    );
    if (href.startsWith('http')) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.append(srOnly(` ${newTab}`));
    }
    return [link];
  });
  if (links.length === 0) return undefined;
  return h(
    'div',
    { class: 'card card--handoff' },
    h('p', { class: 'card__title' }, icon('headset', 18), handoff.title),
    h('div', { class: 'card__actions' }, ...links),
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s().-]{6,}$/;

/** Checks the form like the server does, so most mistakes are caught before sending. */
export function validateLead(
  lead: LeadFields,
  strings: UiStrings['lead'],
): Partial<Record<keyof LeadFields, string>> {
  const errors: Partial<Record<keyof LeadFields, string>> = {};
  if (!lead.name.trim()) errors.name = strings.invalid.name;
  if (lead.email && !EMAIL.test(lead.email)) errors.email = strings.invalid.email;
  if (lead.phone && !PHONE.test(lead.phone)) errors.phone = strings.invalid.phone;
  if (!lead.email && !lead.phone) errors.email = strings.invalid.contact;
  return errors;
}

function leadForm(reason: string, messageId: string, ctx: ViewContext): HTMLElement {
  const strings = ctx.strings.lead;
  const prefix = `lead-${messageId}`;
  const field = (
    name: keyof LeadFields,
    label: string,
    attrs: Record<string, string | boolean>,
    multiline = false,
  ) => {
    const id = `${prefix}-${name}`;
    const control = multiline
      ? h('textarea', { id, name, rows: '3', ...attrs })
      : h('input', { id, name, ...attrs });
    const error = h('p', { class: 'field__error', id: `${id}-error`, hidden: true });
    return {
      name,
      control,
      error,
      root: h('div', { class: 'field' }, h('label', { for: id }, label), control, error),
    };
  };
  const fields = [
    field('name', strings.name, { autocomplete: 'name', required: true, maxlength: '120' }),
    field('email', `${strings.email} ${strings.optional}`, {
      type: 'email',
      autocomplete: 'email',
      maxlength: '200',
    }),
    field('phone', `${strings.phone} ${strings.optional}`, {
      type: 'tel',
      autocomplete: 'tel',
      maxlength: '40',
    }),
    field('message', `${strings.message} ${strings.optional}`, { maxlength: '2000' }, true),
  ];
  const status = h('p', { class: 'card__status', role: 'status' });
  const submit = h(
    'button',
    { type: 'submit', class: 'btn btn--primary' },
    icon('send', 16),
    strings.submit,
  );
  const form = h(
    'form',
    { class: 'card card--lead', novalidate: true, 'aria-labelledby': `${prefix}-title` },
    h('p', { class: 'card__title', id: `${prefix}-title` }, strings.title),
    reason && h('p', { class: 'card__text' }, reason),
    ...fields.map((f) => f.root),
    h('p', { class: 'card__hint' }, strings.consent),
    status,
    h('div', { class: 'card__actions' }, submit),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const lead: LeadFields = { name: '' };
    for (const f of fields) {
      const value = f.control.value.trim();
      if (value) lead[f.name] = value;
    }
    const errors = validateLead(lead, strings);
    for (const f of fields) {
      const message = errors[f.name];
      f.error.textContent = message ?? '';
      f.error.hidden = !message;
      if (message) {
        f.control.setAttribute('aria-invalid', 'true');
        f.control.setAttribute('aria-describedby', f.error.id);
      } else {
        f.control.removeAttribute('aria-invalid');
        f.control.removeAttribute('aria-describedby');
      }
    }
    const first = fields.find((f) => errors[f.name]);
    if (first) {
      first.control.focus();
      return;
    }
    if (!ctx.submitLead) return;

    submit.disabled = true;
    submit.replaceChildren(strings.sending);
    status.textContent = '';
    void ctx.submitLead(messageId, lead).then((result) => {
      // On success the message re-renders as "sent"; only failures land here.
      if (result.ok) return;
      submit.disabled = false;
      submit.replaceChildren(icon('send', 16), strings.submit);
      status.textContent = result.message || ctx.strings.errors.network;
      status.classList.add('card__status--error');
    });
  });
  return form;
}

function leadSent(ctx: ViewContext): HTMLElement {
  return h(
    'div',
    { class: 'card card--sent', role: 'status' },
    h('span', { class: 'card__icon' }, icon('check', 18)),
    h(
      'div',
      {},
      h('p', { class: 'card__title' }, ctx.strings.lead.sentTitle),
      h('p', { class: 'card__text' }, ctx.strings.lead.sentText),
    ),
  );
}
