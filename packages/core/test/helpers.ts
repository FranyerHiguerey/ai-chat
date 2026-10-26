import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { defineConfig, type ChatConfigInput } from '../src/config.js';
import { ProviderError } from '../src/errors.js';
import type {
  ChatProvider,
  CompletionRequest,
  FinishReason,
  ToolCall,
  UsageReport,
} from '../src/types.js';

export const FIXTURE_KNOWLEDGE = fileURLToPath(new URL('./fixtures/knowledge', import.meta.url));

export function testConfig(overrides: Partial<ChatConfigInput> = {}) {
  return defineConfig({
    company: {
      name: 'Acme Plastics',
      description: 'Plastic packaging manufacturer.',
      contact: { email: 'hello@acme.test', whatsapp: '+584121234567' },
    },
    knowledgeDir: FIXTURE_KNOWLEDGE,
    ...overrides,
  });
}

export const USAGE: UsageReport = {
  provider: 'fake',
  model: 'fake-model',
  inputTokens: 12,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 900,
  outputTokens: 5,
};

export interface FakeProviderOptions {
  /** Text pieces to stream before `done`. */
  chunks?: string[];
  finishReason?: FinishReason;
  /** Thrown after the chunks instead of finishing. */
  error?: unknown;
  /** Waits for the abort signal after the chunks (to test Stop). */
  hang?: boolean;
  /** Tool calls yielded after the chunks, before `done`. */
  toolCalls?: ToolCall[];
  /** Per-call overrides: call N uses rounds[N] (tool loops). Falls back to the options above. */
  rounds?: Omit<FakeProviderOptions, 'rounds'>[];
}

/** A provider that streams canned output and records each call. */
export function fakeProvider(options: FakeProviderOptions = {}) {
  // complete() uses these; stream() reads them per round.
  const { chunks = ['Hola, ', 'claro.'], finishReason = 'stop' } = options;
  const calls: { request: CompletionRequest; signal?: AbortSignal }[] = [];

  const provider: ChatProvider = {
    name: 'fake',
    model: 'fake-model',
    complete: vi.fn(async (request: CompletionRequest) => {
      calls.push({ request });
      return { text: chunks.join(''), finishReason, rawStopReason: finishReason, usage: USAGE };
    }),
    async *stream(request, { signal } = {}) {
      const round = options.rounds?.[calls.length] ?? {};
      const {
        chunks = ['Hola, ', 'claro.'],
        finishReason = 'stop',
        error,
        hang,
        toolCalls = [],
      } = {
        ...options,
        ...round,
      };
      calls.push({ request, signal });
      for (const text of chunks) yield { type: 'text', text };
      if (hang) {
        if (!signal?.aborted) {
          await new Promise((resolve) =>
            signal?.addEventListener('abort', resolve, { once: true }),
          );
        }
        throw new ProviderError('aborted', 'Request aborted');
      }
      if (error) throw error;
      for (const call of toolCalls) yield { type: 'tool_call', ...call };
      yield {
        type: 'done',
        finishReason,
        rawStopReason: finishReason,
        usage: USAGE,
        replay: [`round-${calls.length}`],
      };
    },
  };
  return { provider, calls };
}
