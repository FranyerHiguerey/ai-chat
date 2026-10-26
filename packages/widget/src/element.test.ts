import { afterEach, describe, expect, it, vi } from 'vitest';
import { openStream, reply, sse } from '../test/sse.js';
import type { AiChatElement } from './element.js';
import './index.js';

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
});

function mount(attrs: Record<string, string> = {}, fetch?: typeof globalThis.fetch) {
  const el = document.createElement('ai-chat');
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  if (fetch) el.fetch = fetch;
  document.body.append(el);
  const root = el.shadowRoot!;
  const $ = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  return { el, root, $ };
}

/** Committed replies, not the in-progress draft. */
const ANSWERS = '.msg--assistant:not(.msg--draft)';

const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();

describe('<ai-chat>', () => {
  it('opens from the launcher and closes with Escape, returning focus', () => {
    const { el, $ } = mount({ name: 'Your Brand', lang: 'en' });
    const launcher = $<HTMLButtonElement>('.launcher');
    const panel = $('.panel');
    const opened = vi.fn();
    el.addEventListener('ai-chat:open', opened);

    expect(panel.hidden).toBe(true);
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
    expect(launcher.getAttribute('aria-label')).toBe('Open chat');

    launcher.click();
    expect(el.isOpen).toBe(true);
    expect(panel.hidden).toBe(false);
    expect(launcher.getAttribute('aria-expanded')).toBe('true');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(opened).toHaveBeenCalledOnce();

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(el.isOpen).toBe(false);
    expect(panel.hidden).toBe(true);
    expect(el.shadowRoot?.activeElement).toBe(launcher);
  });

  it('shows the welcome screen with config starters, per language', () => {
    const { el, $, root } = mount({ name: 'Your Brand', lang: 'es', open: '' });
    el.config = {
      greeting: { es: 'Hola, ¿qué buscas?', en: 'Hi, what are you looking for?' },
      starters: { es: ['¿Precios?', { label: 'Horario', icon: 'clock' }], en: ['Prices?'] },
      handoff: { href: 'https://wa.me/584121234567' },
    };
    expect(text($('.welcome__text'))).toBe('Hola, ¿qué buscas?');
    expect([...root.querySelectorAll('.starter')].map(text)).toEqual(['¿Precios?', 'Horario']);
    expect(text($('.handoff-link'))).toContain('Hablar con una persona');
    expect($<HTMLAnchorElement>('.handoff-link').rel).toBe('noopener noreferrer');

    el.setAttribute('lang', 'en');
    expect([...root.querySelectorAll('.starter')].map(text)).toEqual(['Prices?']);
    expect($('textarea').getAttribute('placeholder')).toBe('Type your question…');
  });

  it('accepts config as a JSON attribute and ignores unsafe handoff links', () => {
    const { $ } = mount({
      open: '',
      config: JSON.stringify({ starters: ['A'], handoff: { href: 'javascript:alert(1)' } }),
    });
    expect(text($('.starter'))).toBe('A');
    expect($('.handoff-link')).toBeNull();
    expect($('.header a').hidden).toBe(true);
  });

  it('uses initials when there is no avatar', () => {
    const { $ } = mount({ name: 'Your Brand', open: '' });
    expect(text($('.header .avatar'))).toBe('YB');
  });

  it('shows typing dots right away, then the reply', async () => {
    const stream = openStream();
    const { el, $, root } = mount({ open: '', lang: 'en' }, stream.fetch);
    const message = vi.fn();
    el.addEventListener('ai-chat:message', message);

    const input = $<HTMLTextAreaElement>('textarea');
    input.value = 'Hello';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(input.value).toBe('');
    expect(text($('.msg--user'))).toBe('You: Hello');
    expect($('.dots')).not.toBeNull();
    expect($('.welcome').hidden).toBe(true);
    expect($('.send').getAttribute('aria-label')).toBe('Stop reply');

    stream.push(reply('**Three** days'));
    await vi.waitFor(() => expect(message).toHaveBeenCalledOnce());
    const answer = root.querySelectorAll(ANSWERS);
    expect(answer).toHaveLength(1);
    expect(answer[0]?.querySelector('strong')?.textContent).toBe('Three');
    expect(text($('[aria-live="polite"]'))).toBe('**Three** days');
    expect($('.send').getAttribute('aria-label')).toBe('Send');
  });

  it('Stop with no text yet puts the question back in the input', () => {
    const stream = openStream();
    const { $ } = mount({ open: '' }, stream.fetch);
    const input = $<HTMLTextAreaElement>('textarea');
    input.value = 'Hola';
    $<HTMLFormElement>('form').requestSubmit();
    $<HTMLFormElement>('form').requestSubmit(); // The button is Stop now.
    expect(input.value).toBe('Hola');
    expect($('.msg--user')).toBeNull();
  });

  it('shows an error with Retry, and too_many_turns offers a new conversation', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(sse(reply('Ok')))
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: 'too_many_turns', message: 'Conversación muy larga.' } },
          { status: 400 },
        ),
      );
    const { el, $, root } = mount({ open: '', lang: 'es' }, fetch);

    el.send('Hola');
    await vi.waitFor(() => expect($('[role="alert"]')).not.toBeNull());
    expect(text($('.msg--error__title'))).toBe('Sin conexión');
    expect(text($('[role="alert"]'))).toContain('Se perdió la conexión');

    $<HTMLButtonElement>('[role="alert"] button').click();
    await vi.waitFor(() => expect(root.querySelectorAll(ANSWERS)).toHaveLength(1));
    expect($('[role="alert"]')).toBeNull();

    el.send('Otra');
    await vi.waitFor(() => expect($('[role="alert"]')).not.toBeNull());
    expect(text($('[role="alert"]'))).toContain('Conversación muy larga.');
    // Only a new conversation helps now: the input is locked until then.
    expect($<HTMLTextAreaElement>('textarea').disabled).toBe(true);
    $<HTMLButtonElement>('[role="alert"] .btn--primary').click();
    expect(root.querySelectorAll('.msg')).toHaveLength(0);
    expect($('.welcome').hidden).toBe(false);
    expect($<HTMLTextAreaElement>('textarea').disabled).toBe(false);
  });

  it('offers the handoff link in an error when one is configured', async () => {
    const { el, $ } = mount({ open: '', lang: 'en' }, async () => {
      throw new TypeError('Failed to fetch');
    });
    el.config = { handoff: { href: 'https://wa.me/10000000000' } };
    el.send('Hello');
    await vi.waitFor(() => expect($('[role="alert"]')).not.toBeNull());
    const link = $<HTMLAnchorElement>('[role="alert"] a');
    expect(link.href).toBe('https://wa.me/10000000000');
    expect(text(link)).toContain('Talk to a person');
  });

  it('restores the conversation and open state after a reload', async () => {
    const first = mount({ open: '' }, async () => sse(reply('Hola de nuevo')));
    first.el.send('Hola');
    await vi.waitFor(() => expect(first.root.querySelectorAll(ANSWERS)).toHaveLength(1));
    first.el.remove();

    const second = mount();
    expect(second.el.isOpen).toBe(true);
    expect(second.root.querySelectorAll('.msg')).toHaveLength(2);
    expect(second.$('.welcome').hidden).toBe(true);
  });

  it('shows the teaser until dismissed', () => {
    const { el, $ } = mount({ lang: 'en' });
    el.config = { teaser: 'Questions? I can help.' };
    expect($('.teaser').hidden).toBe(false);
    $<HTMLButtonElement>('.teaser__close').click();
    expect($('.teaser').hidden).toBe(true);
    el.config = { teaser: 'Again' };
    expect($('.teaser').hidden).toBe(true);
  });

  it('applies a config set before the element was defined', async () => {
    const el = document.createElement('ai-chat-late') as AiChatElement;
    (el as { config?: unknown }).config = { starters: ['Early'] };
    el.setAttribute('open', '');
    document.body.append(el);
    const { defineAiChat } = await import('./index.js');
    defineAiChat('ai-chat-late');
    expect(text(el.shadowRoot?.querySelector('.starter'))).toBe('Early');
  });

  describe('remote-config', () => {
    const settings = (widget: unknown) => Response.json({ protocol: 1, widget });

    it('loads name, greeting and starters from the endpoint on GET', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        settings({
          name: 'Nova',
          greeting: { en: 'Hi from the dashboard' },
          starters: ['Prices?'],
        }),
      );
      const { $, root } = mount(
        { 'remote-config': '', open: '', lang: 'en', endpoint: '/chat' },
        fetch,
      );

      await vi.waitFor(() => expect(text($('.welcome__text'))).toBe('Hi from the dashboard'));
      expect(text($('.welcome__title'))).toBe('Nova');
      expect([...root.querySelectorAll('.starter')].map(text)).toEqual(['Prices?']);
      expect(fetch).toHaveBeenCalledWith('/chat', expect.not.objectContaining({ method: 'POST' }));
    });

    it('lets markup and the config property win over the endpoint', async () => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          settings({ name: 'Remote', greeting: 'Remote hi', teaser: 'Remote teaser' }),
        );
      const { el, $ } = mount({ 'remote-config': '', open: '', name: 'Markup', lang: 'en' }, fetch);
      el.config = { greeting: 'Config hi' };

      await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
      await vi.waitFor(() => expect(text($('.welcome__title'))).toBe('Markup'));
      expect(text($('.welcome__text'))).toBe('Config hi');
    });

    it('keeps working when the endpoint has no settings', async () => {
      vi.spyOn(console, 'debug').mockImplementation(() => {});
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(Response.json({ error: {} }, { status: 405 }))
        .mockResolvedValueOnce(sse(reply('Hola')));
      const { el, $, root } = mount(
        { 'remote-config': '', open: '', name: 'Acme', lang: 'es' },
        fetch,
      );

      await vi.waitFor(() => expect(console.debug).toHaveBeenCalled());
      expect(text($('.welcome__title'))).toBe('Acme');
      el.send('Hola');
      await vi.waitFor(() => expect(root.querySelectorAll(ANSWERS)).toHaveLength(1));
    });

    it('makes no request without the attribute', () => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      mount({ open: '' }, fetch);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
