import type { ChatConfig, ChatEnv } from './config.js';
import { stringsFor } from './i18n.js';
import { loadKnowledge } from './knowledge.js';
import { buildSystemPrompt } from './prompt.js';
import type { ServerEvent } from './protocol.js';
import { createProvider } from './providers/index.js';
import type {
  ChatMessage,
  ChatProvider,
  FinishReason,
  StreamOptions,
  SystemPrompt,
  UsageReport,
} from './types.js';

export interface AskResult {
  text: string;
  /** `max_tokens` means the reply was cut off by `limits.maxTokens`. */
  finishReason: FinishReason;
  usage: UsageReport;
}

export interface AskOptions {
  /** Language for fixed replies; defaults to the site's default language. */
  lang?: string;
}

export interface ChatStreamOptions extends AskOptions, StreamOptions {
  /** Called with this reply's usage, after the client-wide `onUsage`. */
  onUsage?: (usage: UsageReport) => void;
}

/** The events a chat stream yields. `start` and `error` are added by the HTTP handler. */
export type ChatStreamEvent = Extract<ServerEvent, { type: 'delta' | 'replace' | 'done' }>;

export interface ChatClientOptions {
  config: ChatConfig;
  env: ChatEnv;
  /** Inject a provider (tests, custom setups). Defaults to the one chosen by `env.provider`. */
  provider?: ChatProvider;
  /** Called after every request with token usage. Defaults to a one-line JSON log. */
  onUsage?: (usage: UsageReport) => void;
}

export interface ChatClient {
  system: SystemPrompt;
  ask(messages: ChatMessage[], options?: AskOptions): Promise<AskResult>;
  /** Streams a reply. Provider failures are thrown as ProviderError. */
  stream(messages: ChatMessage[], options?: ChatStreamOptions): AsyncGenerator<ChatStreamEvent>;
}

function logUsage(usage: UsageReport): void {
  console.info(JSON.stringify({ event: 'ai-chat.usage', ...usage }));
}

/**
 * Loads the knowledge folder and builds the system prompt once, then returns a
 * client that answers conversations.
 */
export async function createChatClient(options: ChatClientOptions): Promise<ChatClient> {
  const { config, env, onUsage = logUsage } = options;
  const provider = options.provider ?? (await createProvider(env));
  const system = buildSystemPrompt(config, await loadKnowledge(config.knowledgeDir));
  const maxTokens = config.limits.maxTokens;

  async function ask(messages: ChatMessage[], { lang }: AskOptions = {}): Promise<AskResult> {
    const result = await provider.complete({ system, messages, maxTokens });
    onUsage(result.usage);

    if (result.finishReason === 'refusal') {
      const text = stringsFor(lang, config).refusal;
      return { text, finishReason: 'refusal', usage: result.usage };
    }
    return { text: result.text, finishReason: result.finishReason, usage: result.usage };
  }

  async function* stream(
    messages: ChatMessage[],
    { lang, signal, onUsage: onReplyUsage }: ChatStreamOptions = {},
  ): AsyncGenerator<ChatStreamEvent> {
    for await (const event of provider.stream({ system, messages, maxTokens }, { signal })) {
      if (event.type === 'text') {
        yield { type: 'delta', text: event.text };
        continue;
      }
      onUsage(event.usage);
      onReplyUsage?.(event.usage);
      if (event.finishReason === 'refusal') {
        // A refusal can arrive after partial output; that partial must not be kept.
        yield { type: 'replace', text: stringsFor(lang, config).refusal };
      }
      yield { type: 'done', finishReason: event.finishReason };
    }
  }

  return { system, ask, stream };
}
