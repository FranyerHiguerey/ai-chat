import { streamChat, type ChatMessage } from '@franyerhiguerey/ai-chat-client';
import type { Store } from './store.js';
import {
  createMessage,
  textOf,
  type ChatError,
  type Language,
  type Message,
  type Notice,
} from './types.js';

/** `waiting`: sent, nothing back yet (typing dots). `streaming`: text is arriving. */
export type Status = 'idle' | 'waiting' | 'streaming';

export interface ChatState {
  messages: Message[];
  status: Status;
  /** The reply being streamed; committed as a message when it ends. */
  draft: string;
  error?: ChatError;
}

export interface ControllerOptions {
  endpoint: string;
  lang: () => Language;
  store?: Store;
  fetch?: typeof fetch;
  onMessage?: (message: Message) => void;
  onError?: (error: ChatError) => void;
}

const STORE_VERSION = 1;

/** Errors a retry can't fix: the request itself was rejected. */
const FINAL_ERRORS = new Set([
  'invalid_request',
  'message_too_long',
  'too_many_turns',
  'method_not_allowed',
]);

export const isRetryable = (code: string): boolean => !FINAL_ERRORS.has(code);

/**
 * The conversation, without any DOM: sends turns, streams replies through
 * `streamChat()`, and handles stop, retry, reset and persistence. The server is
 * stateless, so the whole history goes with every request.
 */
export class ChatController {
  private current: ChatState;
  private readonly listeners = new Set<(state: ChatState) => void>();
  private run?: AbortController;

  constructor(private readonly options: ControllerOptions) {
    const messages = restoreMessages(options.store?.load());
    // A reload mid-reply leaves an unanswered question: offer Retry.
    const interrupted = messages.at(-1)?.role === 'user';
    this.current = {
      messages,
      status: 'idle',
      draft: '',
      error: interrupted ? { code: 'network', message: '' } : undefined,
    };
  }

  get state(): ChatState {
    return this.current;
  }

  get busy(): boolean {
    return this.current.status !== 'idle';
  }

  subscribe(listener: (state: ChatState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sends a visitor message. Returns false when empty or a reply is in progress. */
  send(text: string): boolean {
    const content = text.trim();
    if (!content || this.busy) return false;
    let messages = this.current.messages;
    // A question that failed unanswered is replaced, so roles keep alternating.
    if (messages.at(-1)?.role === 'user') messages = messages.slice(0, -1);
    this.update({
      messages: [...messages, createMessage('user', content)],
      status: 'waiting',
      draft: '',
      error: undefined,
    });
    this.persist();
    void this.request();
    return true;
  }

  /** Asks again for the last unanswered question. */
  retry(): void {
    if (this.busy || this.current.messages.at(-1)?.role !== 'user') return;
    this.update({ status: 'waiting', draft: '', error: undefined });
    void this.request();
  }

  /**
   * Stops the reply. What arrived so far is kept. If nothing arrived, the
   * question is taken back and returned, so the UI can put it in the input.
   */
  stop(): string | undefined {
    if (!this.run) return undefined;
    this.run.abort();
    this.run = undefined;
    if (this.current.draft.trim()) {
      this.commit(this.current.draft, 'stopped');
      return undefined;
    }
    const question = this.current.messages.at(-1);
    this.update({ messages: this.current.messages.slice(0, -1), status: 'idle', draft: '' });
    this.persist();
    return question ? textOf(question) : undefined;
  }

  reset(): void {
    this.run?.abort();
    this.run = undefined;
    this.update({ messages: [], status: 'idle', draft: '', error: undefined });
    this.options.store?.clear();
  }

  private async request(): Promise<void> {
    const run = new AbortController();
    this.run = run;
    const messages: ChatMessage[] = this.current.messages.map((message) => ({
      role: message.role,
      content: textOf(message),
    }));
    const events = streamChat({
      endpoint: this.options.endpoint,
      messages,
      lang: this.options.lang(),
      signal: run.signal,
      fetch: this.options.fetch,
    });
    for await (const event of events) {
      if (this.run !== run) return; // Stopped or reset meanwhile.
      switch (event.type) {
        case 'delta':
          this.update({ status: 'streaming', draft: this.current.draft + event.text });
          break;
        case 'replace':
          this.update({ status: 'streaming', draft: event.text });
          break;
        case 'done':
          this.run = undefined;
          if (this.current.draft.trim()) {
            this.commit(
              this.current.draft,
              event.finishReason === 'max_tokens' ? 'cut_off' : undefined,
            );
          } else {
            this.fail({ code: 'bad_response', message: '' });
          }
          return;
        case 'error':
          this.run = undefined;
          this.fail({ code: event.code, message: event.message });
          return;
      }
    }
  }

  private commit(text: string, notice?: Notice): void {
    const message = createMessage('assistant', text, notice);
    this.update({
      messages: [...this.current.messages, message],
      status: 'idle',
      draft: '',
    });
    this.persist();
    this.options.onMessage?.(message);
  }

  private fail(error: ChatError): void {
    this.update({ status: 'idle', draft: '', error });
    this.options.onError?.(error);
  }

  private update(patch: Partial<ChatState>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) listener(this.current);
  }

  private persist(): void {
    this.options.store?.save({ v: STORE_VERSION, messages: this.current.messages });
  }
}

/** Saved messages, or none if the stored value is missing, old or malformed. */
export function restoreMessages(saved: unknown): Message[] {
  if (!saved || typeof saved !== 'object') return [];
  const { v, messages } = saved as { v?: unknown; messages?: unknown };
  if (v !== STORE_VERSION || !Array.isArray(messages)) return [];
  return messages.every(isMessage) ? messages : [];
}

function isMessage(value: unknown): value is Message {
  const message = value as Partial<Message> | null;
  return (
    typeof message?.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    Array.isArray(message.parts) &&
    message.parts.every((part) => part?.type === 'text' && typeof part.text === 'string')
  );
}
