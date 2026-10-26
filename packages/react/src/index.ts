import { createElement, useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import type {
  AiChatElement,
  ChatError,
  Language,
  Message,
  Theme,
  WidgetConfig,
} from '@franyerhiguerey/ai-chat-widget';

export type {
  ChatError,
  Language,
  Localized,
  Message,
  Starter,
  StarterIcon,
  Theme,
  WidgetConfig,
} from '@franyerhiguerey/ai-chat-widget';

export interface AiChatProps {
  /** URL of the site's chat endpoint. Defaults to `/api/chat`. */
  endpoint?: string;
  name?: string;
  avatar?: string;
  lang?: Language;
  theme?: Theme;
  status?: string;
  maxChars?: number;
  config?: WidgetConfig;
  /** Opens or closes the panel. Leave it out to let the widget manage itself. */
  open?: boolean;
  className?: string;
  /** Takes the `--chat-*` design tokens, e.g. `{ '--chat-brand': '#C2410C' }`. */
  style?: CSSProperties & Record<`--chat-${string}`, string>;
  onOpen?: () => void;
  onClose?: () => void;
  onMessage?: (message: Message) => void;
  onError?: (error: ChatError) => void;
  /** A lead form was delivered (no form data, for analytics). */
  onLead?: () => void;
}

/**
 * Renders the `<ai-chat>` widget. The element registers on mount, so it is
 * safe in server-rendered apps: the server outputs a plain tag and the
 * browser upgrades it.
 */
export function AiChat(props: AiChatProps): ReactElement {
  const { endpoint, name, avatar, lang, theme, status, maxChars, config, open, className, style } =
    props;
  const ref = useRef<AiChatElement>(null);
  // Latest handlers, so listeners are attached once.
  const handlers = useRef(props);
  handlers.current = props;

  useEffect(() => {
    void import('@franyerhiguerey/ai-chat-widget');
  }, []);

  useEffect(() => {
    if (ref.current) ref.current.config = config ?? {};
  }, [config]);

  useEffect(() => {
    if (ref.current && open !== undefined) ref.current.toggleAttribute('open', open);
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listeners: [string, (event: Event) => void][] = [
      ['ai-chat:open', () => handlers.current.onOpen?.()],
      ['ai-chat:close', () => handlers.current.onClose?.()],
      [
        'ai-chat:message',
        (event) =>
          handlers.current.onMessage?.((event as CustomEvent<{ message: Message }>).detail.message),
      ],
      [
        'ai-chat:error',
        (event) => handlers.current.onError?.((event as CustomEvent<ChatError>).detail),
      ],
      ['ai-chat:lead', () => handlers.current.onLead?.()],
    ];
    for (const [type, listener] of listeners) el.addEventListener(type, listener);
    return () => {
      for (const [type, listener] of listeners) el.removeEventListener(type, listener);
    };
  }, []);

  return createElement('ai-chat', {
    ref,
    endpoint,
    name,
    avatar,
    lang,
    theme,
    status,
    'max-chars': maxChars === undefined ? undefined : String(maxChars),
    className,
    style,
  });
}
