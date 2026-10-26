import Anthropic from '@anthropic-ai/sdk';
import { fromSdkError } from '../errors.js';
import type {
  ChatProvider,
  CompletionRequest,
  CompletionResult,
  FinishReason,
  ToolCall,
  ToolRound,
  ToolSpec,
} from '../types.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  /** Inject an SDK client (tests, custom base URL). */
  client?: Anthropic;
}

export function createAnthropicProvider(options: AnthropicProviderOptions): ChatProvider {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const { model } = options;

  function params({ system, messages, maxTokens, tools, rounds = [] }: CompletionRequest) {
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
      messages: [...messages, ...rounds.flatMap(toAnthropicTurns)],
      output_config: { effort: 'low' as const },
      // Tools render before the system prompt, so the breakpoint above caches them too.
      ...(tools?.length ? { tools: tools.map(toAnthropicTool) } : {}),
    };
  }

  return {
    name: 'anthropic',
    model,

    async complete(request) {
      try {
        const message = await client.messages.create(params(request));
        return { text: textOf(message), toolCalls: toolCallsOf(message), ...summarize(message) };
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
        // Tool inputs are small and only used once the reply is over, so they're
        // read whole from the final message rather than streamed.
        const final = await stream.finalMessage();
        for (const call of toolCallsOf(final)) yield { type: 'tool_call', ...call };
        yield { type: 'done', ...summarize(final), replay: final.content };
      } catch (error) {
        throw fromSdkError(error, Anthropic, signal);
      }
    },
  };
}

/**
 * A round replayed as the assistant's own content (thinking blocks included,
 * unchanged), then one user turn with every tool result.
 */
function toAnthropicTurns(round: ToolRound): Anthropic.MessageParam[] {
  return [
    { role: 'assistant', content: round.replay as Anthropic.ContentBlockParam[] },
    {
      role: 'user',
      content: round.results.map((result) => ({
        type: 'tool_result' as const,
        tool_use_id: result.id,
        content: result.output,
      })),
    },
  ];
}

/** `strict` makes the API guarantee inputs that match the schema. */
function toAnthropicTool(tool: ToolSpec): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
    strict: true,
  };
}

function toolCallsOf(message: Anthropic.Message): ToolCall[] {
  return message.content
    .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
    .map((block) => ({ id: block.id, name: block.name, input: block.input }));
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
