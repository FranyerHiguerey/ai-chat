/** A conversation turn as the widget sends it. Provider-neutral on purpose. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** The system prompt split so each provider can place its cache boundary. */
export interface SystemPrompt {
  /** Fixed rules. */
  instructions: string;
  /** Company info and knowledge documents. Large and stable: the part worth caching. */
  knowledge: string;
}

export type FinishReason = 'stop' | 'max_tokens' | 'refusal';

/**
 * Token usage normalized across providers. `inputTokens` counts only uncached
 * input, so the three input fields add up to the full prompt size.
 */
export interface UsageReport {
  provider: string;
  model: string;
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
}

/**
 * A tool the model may call, in provider-neutral form. `parameters` is JSON
 * Schema limited to what both providers accept in strict mode: every property
 * required, `additionalProperties: false`, no length or count keywords.
 */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CompletionRequest {
  system: SystemPrompt;
  messages: ChatMessage[];
  maxTokens: number;
  /** Must be identical between requests (same order too), or the prompt cache misses. */
  tools?: ToolSpec[];
  /** Earlier rounds of this same reply, replayed after `messages` so the model can continue. */
  rounds?: ToolRound[];
  /** `none` makes the model answer in text without calling tools (the last round of a reply). */
  toolChoice?: 'auto' | 'none';
}

/**
 * One finished round of a reply that called tools: the model's own output,
 * replayed unchanged (reasoning and thinking included, as both APIs require),
 * then what each call returned.
 */
export interface ToolRound {
  /** Provider-specific; only the provider that produced it reads it. */
  replay: unknown;
  results: { id: string; output: string }[];
}

/** A tool call from the model. `input` is unvalidated: check it before use. */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface CompletionResult {
  text: string;
  /** Tool calls the model made (non-streaming `complete`). */
  toolCalls?: ToolCall[];
  finishReason: FinishReason;
  /** The provider's own stop reason, for logs. */
  rawStopReason: string | null;
  usage: UsageReport;
  /** This round's output in provider form, to replay if the reply continues after tool calls. */
  replay?: unknown;
}

export interface ChatProvider {
  name: string;
  model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
  /** Streams the reply. Errors are thrown as ProviderError. */
  stream(request: CompletionRequest, options?: StreamOptions): AsyncIterable<ProviderEvent>;
}

/** What a provider stream yields: text pieces, then any tool calls, then exactly one `done`. */
export type ProviderEvent =
  | { type: 'text'; text: string }
  | ({ type: 'tool_call' } & ToolCall)
  | ({ type: 'done' } & Omit<CompletionResult, 'text'>);

export interface StreamOptions {
  /** Aborting stops the upstream request, so no more tokens are billed. */
  signal?: AbortSignal;
}
