import { AiChatElement } from './element.js';

export { AiChatElement, type AiChatEventMap } from './element.js';
export { renderMarkdown, safeUrl } from './markdown.js';
export type {
  ChatError,
  Language,
  Localized,
  Message,
  MessagePart,
  Notice,
  Starter,
  StarterIcon,
  Theme,
  WidgetConfig,
} from './types.js';

/** Registers the element. Safe to call more than once, and a no-op outside the browser. */
export function defineAiChat(tag = 'ai-chat'): void {
  if (typeof customElements === 'undefined' || customElements.get(tag)) return;
  customElements.define(tag, class extends AiChatElement {});
}

defineAiChat();

declare global {
  interface HTMLElementTagNameMap {
    'ai-chat': AiChatElement;
  }
}
