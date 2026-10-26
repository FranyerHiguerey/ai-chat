import OpenAI from 'openai';
import { fromSdkError, ProviderError } from '../errors.js';
import type {
  ChatProvider,
  CompletionRequest,
  CompletionResult,
  FinishReason,
  ToolCall,
  ToolRound,
  ToolSpec,
} from '../types.js';

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  /** Inject an SDK client (tests, custom base URL). */
  client?: OpenAI;
}

export function createOpenAIProvider(options: OpenAIProviderOptions): ChatProvider {
  const client = options.client ?? new OpenAI({ apiKey: options.apiKey });
  const { model } = options;

  function params({
    system,
    messages,
    maxTokens,
    tools,
    rounds = [],
    toolChoice,
  }: CompletionRequest) {
    return {
      model,
      // OpenAI caches stable prompt prefixes automatically (no marker needed),
      // so keep the instructions + knowledge identical and first.
      instructions: `${system.instructions}\n\n${system.knowledge}`,
      input: [
        ...messages.map((message) => ({ role: message.role, content: message.content })),
        ...rounds.flatMap(toOpenAIItems),
      ],
      max_output_tokens: maxTokens,
      // Visitor conversations shouldn't be kept on OpenAI's side.
      store: false,
      ...(tools?.length
        ? {
            tools: tools.map(toOpenAITool),
            // With store: false, a reply that continues after a tool call must
            // send its reasoning back; the encrypted copy is how.
            include: ['reasoning.encrypted_content' as const],
            ...(toolChoice === 'none' ? { tool_choice: 'none' as const } : {}),
          }
        : {}),
    };
  }

  return {
    name: 'openai',
    model,

    async complete(request) {
      try {
        const response = await client.responses.create(params(request));
        return {
          text: response.output_text,
          toolCalls: toolCallsOf(response),
          ...summarize(response),
        };
      } catch (error) {
        throw fromSdkError(error, OpenAI);
      }
    },

    async *stream(request, { signal } = {}) {
      try {
        const stream = await client.responses.create(
          { ...params(request), stream: true },
          { signal },
        );
        let refused = false;
        let final: OpenAI.Responses.Response | undefined;

        for await (const event of stream) {
          switch (event.type) {
            case 'response.output_text.delta':
              yield { type: 'text', text: event.delta };
              break;
            case 'response.refusal.delta':
              // Never shown: the client replaces it with the site's fixed reply.
              refused = true;
              break;
            case 'response.completed':
            case 'response.incomplete':
              final = event.response;
              break;
            case 'response.failed':
              throw new ProviderError(
                event.response.error?.code === 'rate_limit_exceeded'
                  ? 'rate_limited'
                  : 'unavailable',
                event.response.error?.message ?? 'Response failed',
              );
            case 'error':
              throw new ProviderError(
                event.code === 'rate_limit_exceeded' ? 'rate_limited' : 'unavailable',
                event.message,
              );
          }
        }

        if (!final) throw new ProviderError('unavailable', 'Stream ended without a final response');
        for (const call of toolCallsOf(final)) yield { type: 'tool_call', ...call };
        yield { type: 'done', ...summarize(final, refused), replay: final.output };
      } catch (error) {
        throw fromSdkError(error, OpenAI, signal);
      }
    },
  };
}

/** A round replayed as the model's own output items, then one output per call. */
function toOpenAIItems(round: ToolRound): OpenAI.Responses.ResponseInputItem[] {
  return [
    ...(round.replay as OpenAI.Responses.ResponseInputItem[]),
    ...round.results.map((result) => ({
      type: 'function_call_output' as const,
      call_id: result.id,
      output: result.output,
    })),
  ];
}

/** `strict` makes the API guarantee arguments that match the schema. */
function toOpenAITool(tool: ToolSpec): OpenAI.Responses.FunctionTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true,
  };
}

/** Function calls in the final output. Arguments that aren't valid JSON drop the call. */
function toolCallsOf(response: OpenAI.Responses.Response): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const item of response.output) {
    if (item.type !== 'function_call') continue;
    try {
      calls.push({ id: item.call_id, name: item.name, input: JSON.parse(item.arguments) });
    } catch {
      // Malformed arguments: skip this call, keep the reply.
    }
  }
  return calls;
}

function summarize(
  response: OpenAI.Responses.Response,
  refusedWhileStreaming = false,
): Omit<CompletionResult, 'text'> {
  const refused =
    refusedWhileStreaming ||
    response.incomplete_details?.reason === 'content_filter' ||
    response.output.some(
      (item) => item.type === 'message' && item.content.some((part) => part.type === 'refusal'),
    );
  const finishReason: FinishReason = refused
    ? 'refusal'
    : response.incomplete_details?.reason === 'max_output_tokens'
      ? 'max_tokens'
      : 'stop';

  const usage = response.usage;
  const cached = usage?.input_tokens_details.cached_tokens ?? 0;

  return {
    finishReason,
    rawStopReason: response.incomplete_details?.reason ?? response.status ?? null,
    usage: {
      provider: 'openai',
      model: response.model,
      // OpenAI's input_tokens includes cached tokens; report them separately.
      inputTokens: (usage?.input_tokens ?? 0) - cached,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: cached,
      outputTokens: usage?.output_tokens ?? 0,
    },
  };
}
