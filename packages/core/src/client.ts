import type { ChatConfig, ChatEnv } from './config.js';
import { stringsFor } from './i18n.js';
import { KnowledgeError, loadKnowledge, type KnowledgeDoc } from './knowledge.js';
import { buildSystemPrompt } from './prompt.js';
import type { ServerEvent } from './protocol.js';
import { createProvider } from './providers/index.js';
import { toolEvent, toolsFor, type ToolEvent } from './tools.js';
import type {
  ChatMessage,
  ChatProvider,
  FinishReason,
  ProviderEvent,
  ToolRound,
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
export type ChatStreamEvent = Extract<
  ServerEvent,
  { type: 'delta' | 'replace' | 'suggestions' | 'card' | 'done' }
>;

export interface ChatClientOptions {
  config: ChatConfig;
  env: ChatEnv;
  /** Inject a provider (tests, custom setups). Defaults to the one chosen by `env.provider`. */
  provider?: ChatProvider;
  /** Called after every request with token usage. Defaults to a one-line JSON log. */
  onUsage?: (usage: UsageReport) => void;
  /** Knowledge already loaded (from a source). Otherwise it's read from `config.knowledgeDir`. */
  knowledge?: KnowledgeDoc[];
}

export interface ChatClient {
  system: SystemPrompt;
  ask(messages: ChatMessage[], options?: AskOptions): Promise<AskResult>;
  /** Streams a reply. Provider failures are thrown as ProviderError. */
  stream(messages: ChatMessage[], options?: ChatStreamOptions): AsyncGenerator<ChatStreamEvent>;
}

/** Model calls per reply: one that calls tools, one that answers. */
const MAX_ROUNDS = 2;
const TOOL_SHOWN = 'Shown to the visitor. Now write your short answer.';
const TOOL_NOT_SHOWN = 'Not shown (already shown or invalid input). Write your short answer.';

/** Sums the usage of a reply's rounds, so the reply is billed and logged once. */
function addUsage(a: UsageReport, b: UsageReport): UsageReport {
  return {
    ...b,
    inputTokens: a.inputTokens + b.inputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

/** Which tool produced a held event, so each tool shows at most once per reply. */
const toolOf = (event: ToolEvent) =>
  event.type === 'suggestions'
    ? 'suggest_replies'
    : event.kind === 'handoff'
      ? 'offer_handoff'
      : 'show_lead_form';

function logDroppedTool(name: string): void {
  console.warn(
    JSON.stringify({ event: 'ai-chat.error', stage: 'tool', message: `Dropped a ${name} call` }),
  );
}

function logUsage(usage: UsageReport): void {
  console.info(JSON.stringify({ event: 'ai-chat.usage', ...usage }));
}

/** The knowledge to answer from: the docs given, or the knowledge folder. Checked against the size cap. */
async function resolveKnowledge(options: ChatClientOptions): Promise<KnowledgeDoc[]> {
  const { config } = options;
  let docs = options.knowledge;
  if (!docs) {
    if (!config.knowledgeDir) {
      throw new KnowledgeError('No knowledge: set knowledgeDir or pass knowledge from a source');
    }
    docs = await loadKnowledge(config.knowledgeDir);
  }
  if (docs.length === 0) throw new KnowledgeError('No knowledge documents');

  const chars = docs.reduce((sum, doc) => sum + doc.content.length, 0);
  if (chars > config.limits.maxKnowledgeChars) {
    throw new KnowledgeError(
      `Knowledge is ${chars} characters, over limits.maxKnowledgeChars (${config.limits.maxKnowledgeChars})`,
    );
  }
  return docs;
}

/**
 * Loads the knowledge and builds the system prompt once, then returns a client
 * that answers conversations.
 */
export async function createChatClient(options: ChatClientOptions): Promise<ChatClient> {
  const { config, env, onUsage = logUsage } = options;
  const provider = options.provider ?? (await createProvider(env));
  const system = buildSystemPrompt(config, await resolveKnowledge(options));
  const maxTokens = config.limits.maxTokens;
  const tools = toolsFor(config);

  /** No tools: there's no widget to show their results. */
  async function ask(messages: ChatMessage[], { lang }: AskOptions = {}): Promise<AskResult> {
    const result = await provider.complete({ system, messages, maxTokens });
    onUsage(result.usage);

    if (result.finishReason === 'refusal') {
      const text = stringsFor(lang, config).refusal;
      return { text, finishReason: 'refusal', usage: result.usage };
    }
    return { text: result.text, finishReason: result.finishReason, usage: result.usage };
  }

  /**
   * Streams a reply. Models call a tool and wait for its result before
   * answering, so a round that only called tools gets their results ("shown")
   * and continues, up to MAX_ROUNDS model calls. A round that also wrote text
   * is the answer. Tool events are held until the reply ends, so a refusal
   * drops them along with the text, and usage is reported once, summed.
   */
  async function* stream(
    messages: ChatMessage[],
    { lang, signal, onUsage: onReplyUsage }: ChatStreamOptions = {},
  ): AsyncGenerator<ChatStreamEvent> {
    const pending: ToolEvent[] = [];
    const rounds: ToolRound[] = [];
    let usage: UsageReport | undefined;

    for (let round = 1; ; round++) {
      const request = { system, messages, maxTokens, ...(tools.length ? { tools, rounds } : {}) };
      const calls: { id: string; shown: boolean }[] = [];
      let wroteText = false;
      let done: Extract<ProviderEvent, { type: 'done' }> | undefined;

      for await (const event of provider.stream(request, { signal })) {
        if (event.type === 'text') {
          wroteText ||= event.text.trim() !== '';
          yield { type: 'delta', text: event.text };
        } else if (event.type === 'tool_call') {
          // Each tool once per reply; unusable input is dropped and the reply still ends normally.
          const repeated = pending.some((held) => toolOf(held) === event.name);
          const ui = repeated ? undefined : toolEvent(event, config);
          if (ui) pending.push(ui);
          else logDroppedTool(event.name);
          calls.push({ id: event.id, shown: Boolean(ui) });
        } else {
          done = event;
        }
      }
      if (!done) return;
      usage = usage ? addUsage(usage, done.usage) : done.usage;

      const answerPending = calls.length > 0 && !wroteText && done.finishReason === 'stop';
      if (answerPending && round < MAX_ROUNDS) {
        rounds.push({
          replay: done.replay,
          results: calls.map((call) => ({
            id: call.id,
            output: call.shown ? TOOL_SHOWN : TOOL_NOT_SHOWN,
          })),
        });
        continue;
      }

      onUsage(usage);
      onReplyUsage?.(usage);
      if (done.finishReason === 'refusal') {
        // A refusal can arrive after partial output; that partial must not be kept.
        yield { type: 'replace', text: stringsFor(lang, config).refusal };
      } else {
        yield* pending;
      }
      yield { type: 'done', finishReason: done.finishReason };
      return;
    }
  }

  return { system, ask, stream };
}
