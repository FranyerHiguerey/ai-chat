import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiChatElement } from '@franyerhiguerey/ai-chat-widget';
import { AiChat, type AiChatProps } from './index.js';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

async function mount(props: AiChatProps) {
  const view = render(createElement(AiChat, props));
  await vi.waitFor(() => expect(customElements.get('ai-chat')).toBeDefined());
  const el = view.container.querySelector('ai-chat') as AiChatElement;
  return { ...view, el };
}

describe('<AiChat>', () => {
  it('renders <ai-chat> with attributes, tokens and config', async () => {
    const config = { starters: ['¿Precios?'] };
    const { el } = await mount({
      endpoint: '/chat',
      name: 'Your Brand',
      lang: 'es',
      maxChars: 500,
      className: 'chat',
      style: { '--chat-brand': '#C2410C' },
      config,
    });
    expect(el.getAttribute('endpoint')).toBe('/chat');
    expect(el.getAttribute('max-chars')).toBe('500');
    expect(el.className).toBe('chat');
    expect(el.style.getPropertyValue('--chat-brand')).toBe('#C2410C');
    expect(el.config).toBe(config);
    expect(el.shadowRoot?.querySelector('.starter')?.textContent).toContain('¿Precios?');
  });

  it('controls the open state and reports open/close', async () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const { el, rerender } = await mount({ open: false, onOpen, onClose });
    expect(el.isOpen).toBe(false);

    rerender(createElement(AiChat, { open: true, onOpen, onClose }));
    expect(el.isOpen).toBe(true);
    expect(onOpen).toHaveBeenCalledOnce();

    act(() => el.hide());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('forwards message and error events to the latest handlers', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const onError = vi.fn();
    const { el, rerender } = await mount({ onMessage: first });
    rerender(createElement(AiChat, { onMessage: latest, onError }));

    const message = { id: '1', role: 'assistant', parts: [{ type: 'text', text: 'Hola' }] };
    el.dispatchEvent(new CustomEvent('ai-chat:message', { detail: { message } }));
    el.dispatchEvent(
      new CustomEvent('ai-chat:error', { detail: { code: 'network', message: '' } }),
    );
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(message);
    expect(onError).toHaveBeenCalledWith({ code: 'network', message: '' });
  });

  it('renders on the server as a plain tag', () => {
    const html = renderToString(createElement(AiChat, { name: 'Your Brand', theme: 'dark' }));
    expect(html).toBe('<ai-chat name="Your Brand" theme="dark"></ai-chat>');
  });
});
