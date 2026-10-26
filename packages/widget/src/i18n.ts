import { LANGUAGES, type Language } from './types.js';

export interface UiStrings {
  assistant: string;
  openChat: string;
  closeChat: string;
  status: string;
  greeting: (name: string) => string;
  conversation: string;
  placeholder: string;
  send: string;
  stop: string;
  newChat: string;
  talkToPerson: string;
  newTab: string;
  poweredBy: string;
  you: string;
  typing: string;
  stopped: string;
  cutOff: string;
  retry: string;
  dismiss: string;
  /** Short headings over error bubbles, so the kind of failure reads at a glance. */
  errorTitles: { network: string; rate_limited: string; too_many_turns: string; other: string };
  /** Composer placeholder once the conversation hits the turn limit. */
  limitReached: string;
  /** Failures the browser detects itself; server errors arrive already localized. */
  errors: { network: string; bad_response: string };
}

/** Fixed UI text. Model replies follow the visitor's language, not this. */
export const STRINGS: Record<Language, UiStrings> = {
  es: {
    assistant: 'Asistente',
    openChat: 'Abrir chat',
    closeChat: 'Cerrar chat',
    status: 'Responde al instante',
    greeting: (name) => `¡Hola! Soy el asistente de ${name}. ¿En qué te puedo ayudar?`,
    conversation: 'Conversación',
    placeholder: 'Escribe tu consulta aquí…',
    send: 'Enviar',
    stop: 'Detener respuesta',
    newChat: 'Nueva conversación',
    talkToPerson: 'Hablar con una persona',
    newTab: '(se abre en otra pestaña)',
    poweredBy: 'Con tecnología de IA',
    you: 'Tú',
    typing: 'Escribiendo…',
    stopped: 'Respuesta detenida',
    cutOff: 'La respuesta se cortó por su longitud',
    retry: 'Reintentar',
    dismiss: 'Cerrar',
    errorTitles: {
      network: 'Sin conexión',
      rate_limited: 'Mucha demanda',
      too_many_turns: 'Límite alcanzado',
      other: 'Algo salió mal',
    },
    limitReached: 'Inicia una nueva conversación',
    errors: {
      network: 'Se perdió la conexión. Revisa tu internet e inténtalo de nuevo.',
      bad_response: 'Algo salió mal. Inténtalo de nuevo en unos segundos.',
    },
  },
  en: {
    assistant: 'Assistant',
    openChat: 'Open chat',
    closeChat: 'Close chat',
    status: 'Replies instantly',
    greeting: (name) => `Hi! I'm the ${name} assistant. How can I help you?`,
    conversation: 'Conversation',
    placeholder: 'Type your question…',
    send: 'Send',
    stop: 'Stop reply',
    newChat: 'New conversation',
    talkToPerson: 'Talk to a person',
    newTab: '(opens in a new tab)',
    poweredBy: 'AI-powered',
    you: 'You',
    typing: 'Typing…',
    stopped: 'Reply stopped',
    cutOff: 'The reply was cut off for length',
    retry: 'Retry',
    dismiss: 'Dismiss',
    errorTitles: {
      network: 'Connection lost',
      rate_limited: 'High demand',
      too_many_turns: 'Limit reached',
      other: 'Something went wrong',
    },
    limitReached: 'Start a new conversation',
    errors: {
      network: 'The connection was lost. Check your internet and try again.',
      bad_response: 'Something went wrong. Please try again in a few seconds.',
    },
  },
};

/** The first supported language among the candidates (BCP 47 tags like `es-VE` count), else English. */
export function pickLanguage(...candidates: (string | null | undefined)[]): Language {
  for (const candidate of candidates) {
    const base = candidate?.slice(0, 2).toLowerCase();
    if (base && (LANGUAGES as readonly string[]).includes(base)) return base as Language;
  }
  return 'en';
}
