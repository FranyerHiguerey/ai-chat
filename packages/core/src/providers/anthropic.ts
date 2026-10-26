import Anthropic from '@anthropic-ai/sdk';
import { fromSdkError } from '../errors.js';
import type { ChatProvider, CompletionRequest, CompletionResult, FinishReason } from '../types.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  /** Inject an SDK client (tests, custom base URL). */
  client?: Anthropic;
}

export function createAnthropicProvider(options: AnthropicProviderOptions): ChatProvider {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const { model } = options;

  function params({ system, messages, maxTokens }: CompletionRequest) {
    // No temperature / top_p / top_k: the API rejects sampling params.
    return {
      model,
      max_tokens: maxTokens,
      system: [
        { type: 'text' as const, text: system.instructions },
        // Breakpoint on the last block caches the whole system prompt.
        {
          type: 'text' as const,
          text: system.knowledge,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages,
      output_config: { effort: 'low' as const },
    };
  }

  return {
    name: 'anthropic',
    model,

    async complete(request) {
      try {
        const message = await client.messages.create(params(request));
        return { text: textOf(message), ...summarize(message) };
      } catch (error) {
        throw fromSdkError(error, Anthropic);
      }
    },

    async *stream(request, { signal } = {}) {
      try {
        const stream = client.messages.stream(params(request), { signal });
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text };
          }
        }
        yield { type: 'done', ...summarize(await stream.finalMessage()) };
      } catch (error) {
        throw fromSdkError(error, Anthropic, signal);
      }
    },
  };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function summarize(message: Anthropic.Message): Omit<CompletionResult, 'text'> {
  const finishReason: FinishReason =
    message.stop_reason === 'refusal'
      ? 'refusal'
      : message.stop_reason === 'max_tokens'
        ? 'max_tokens'
        : 'stop';

  return {
    finishReason,
    rawStopReason: message.stop_reason,
    usage: {
      provider: 'anthropic',
      model: message.model,
      inputTokens: message.usage.input_tokens,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
      outputTokens: message.usage.output_tokens,
    },
  };
}
