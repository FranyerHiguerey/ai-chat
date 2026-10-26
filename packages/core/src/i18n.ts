import type { ChatConfig, Language } from './config.js';
import type { RequestErrorCode, StreamErrorCode } from './protocol.js';

export interface Strings {
  refusal: string;
  streamErrors: Record<StreamErrorCode, string>;
  requestErrors: Record<RequestErrorCode, string>;
}

/** Fixed text shown to visitors when the model can't give a normal answer. */
export const STRINGS: Record<Language, Strings> = {
  es: {
    refusal:
      'Lo siento, no puedo ayudarte con eso. Si quieres, te pongo en contacto con nuestro equipo.',
    streamErrors: {
      rate_limited: 'Estamos recibiendo muchas consultas. Inténtalo de nuevo en unos segundos.',
      unavailable: 'El asistente no está disponible en este momento. Inténtalo de nuevo.',
      internal: 'Algo salió mal. Inténtalo de nuevo o contáctanos directamente.',
    },
    requestErrors: {
      invalid_request: 'No pudimos procesar el mensaje. Inténtalo de nuevo.',
      message_too_long: 'El mensaje es demasiado largo. Intenta resumirlo.',
      too_many_turns: 'Esta conversación es muy larga. Empieza una nueva para seguir.',
      method_not_allowed: 'Método no permitido.',
      forbidden_origin: 'Este chat no está disponible en este sitio.',
      rate_limited:
        'Estás enviando mensajes muy rápido. Espera unos segundos e inténtalo de nuevo.',
      unavailable: 'El asistente no está disponible por hoy. Contáctanos directamente.',
      lead_failed: 'No pudimos enviar tus datos. Inténtalo de nuevo o escríbenos directamente.',
    },
  },
  en: {
    refusal: "Sorry, I can't help with that. If you like, I can put you in touch with our team.",
    streamErrors: {
      rate_limited:
        "We're getting a lot of questions right now. Please try again in a few seconds.",
      unavailable: 'The assistant is not available right now. Please try again.',
      internal: 'Something went wrong. Please try again or contact us directly.',
    },
    requestErrors: {
      invalid_request: "We couldn't process that message. Please try again.",
      message_too_long: 'That message is too long. Try shortening it.',
      too_many_turns: 'This conversation is very long. Start a new one to continue.',
      method_not_allowed: 'Method not allowed.',
      forbidden_origin: 'This chat is not available on this site.',
      rate_limited: "You're sending messages very fast. Wait a few seconds and try again.",
      unavailable:
        'The assistant is not available for the rest of the day. Please contact us directly.',
      lead_failed: "We couldn't send your details. Please try again or write to us directly.",
    },
  },
};

/** The requested language if the site supports it, otherwise the site's default. */
export function pickLanguage(lang: unknown, config: ChatConfig): Language {
  const supported: readonly string[] = config.languages.supported;
  return typeof lang === 'string' && supported.includes(lang)
    ? (lang as Language)
    : config.languages.default;
}

export function stringsFor(lang: unknown, config: ChatConfig): Strings {
  return STRINGS[pickLanguage(lang, config)];
}
