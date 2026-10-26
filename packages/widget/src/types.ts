export type Language = 'es' | 'en';

export const LANGUAGES: readonly Language[] = ['es', 'en'];

export type Theme = 'auto' | 'light' | 'dark';

/** A value given once, or once per UI language. */
export type Localized<T> = T | Partial<Record<Language, T>>;

export type StarterIcon =
  'chat' | 'package' | 'grid' | 'truck' | 'receipt' | 'help' | 'clock' | 'pin' | 'tag' | 'mail';

export interface Starter {
  label: string;
  icon?: StarterIcon;
  /** What gets sent when tapped. Defaults to `label`. */
  message?: string;
}

/** The parts of the widget that come from the site rather than from attributes. */
export interface WidgetConfig {
  /** First line on the welcome screen. */
  greeting?: Localized<string>;
  /** Starter questions on the welcome screen (3–4 work best). */
  starters?: Localized<(string | Starter)[]>;
  /** A "Talk to a person" link (WhatsApp, email, contact page). Hidden when absent. */
  handoff?: { href: string; label?: Localized<string> };
  /** A short bubble beside the closed launcher. Hidden when absent. */
  teaser?: Localized<string>;
}

/** Rich parts (cards, handoff, lead form) join this union in M4. */
export type MessagePart = { type: 'text'; text: string };

/** Shown under an assistant reply that didn't end normally. */
export type Notice = 'stopped' | 'cut_off';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
  notice?: Notice;
}

export interface ChatError {
  /** A protocol error code, or `network` / `bad_response` from the browser. */
  code: string;
  /** Localized by the server; empty when the widget should localize by `code`. */
  message: string;
}

export function localize<T>(value: Localized<T> | undefined, lang: Language): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const byLang = value as Partial<Record<Language, T>>;
    return byLang[lang] ?? byLang.es ?? byLang.en;
  }
  return value as T;
}

export function textOf(message: Message): string {
  return message.parts.map((part) => part.text).join('');
}

let counter = 0;

export function createMessage(role: Message['role'], text: string, notice?: Notice): Message {
  const id = `${Date.now().toString(36)}-${(counter++).toString(36)}`;
  return { id, role, parts: [{ type: 'text', text }], ...(notice && { notice }) };
}
