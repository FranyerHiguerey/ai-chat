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
  suggestions: string;
  items: {
    label: string;
    view: string;
    quote: string;
    /** What "Quote this" sends as the visitor's message. */
    quoteMessage: (name: string) => string;
  };
  handoff: { title: string; whatsapp: string; email: string };
  lead: {
    title: string;
    name: string;
    email: string;
    phone: string;
    message: string;
    optional: string;
    consent: string;
    submit: string;
    sending: string;
    sentTitle: string;
    sentText: string;
    invalid: { name: string; contact: string; email: string; phone: string };
  };
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
    suggestions: 'Preguntas sugeridas',
    items: {
      label: 'Productos',
      view: 'Ver',
      quote: 'Cotizar',
      quoteMessage: (name) => `Quiero cotizar ${name}`,
    },
    handoff: { title: 'Habla con nuestro equipo', whatsapp: 'WhatsApp', email: 'Correo' },
    lead: {
      title: 'Déjanos tus datos',
      name: 'Nombre',
      email: 'Correo',
      phone: 'Teléfono',
      message: 'Mensaje',
      optional: '(opcional)',
      consent: 'Usaremos tus datos solo para responder a tu consulta.',
      submit: 'Enviar',
      sending: 'Enviando…',
      sentTitle: '¡Recibido!',
      sentText: 'Nuestro equipo te contactará pronto.',
      invalid: {
        name: 'Escribe tu nombre.',
        contact: 'Déjanos un correo o un teléfono.',
        email: 'Revisa el correo.',
        phone: 'Revisa el teléfono.',
      },
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
    suggestions: 'Suggested questions',
    items: {
      label: 'Products',
      view: 'View',
      quote: 'Get a quote',
      quoteMessage: (name) => `I'd like a quote for ${name}`,
    },
    handoff: { title: 'Talk to our team', whatsapp: 'WhatsApp', email: 'Email' },
    lead: {
      title: 'Leave us your details',
      name: 'Name',
      email: 'Email',
      phone: 'Phone',
      message: 'Message',
      optional: '(optional)',
      consent: "We'll only use your details to answer your request.",
      submit: 'Send',
      sending: 'Sending…',
      sentTitle: 'Got it!',
      sentText: 'Our team will contact you soon.',
      invalid: {
        name: 'Please enter your name.',
        contact: 'Leave an email or a phone number.',
        email: 'Check the email address.',
        phone: 'Check the phone number.',
      },
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
