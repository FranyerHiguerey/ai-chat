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

export interface CompletionRequest {
  system: SystemPrompt;
  messages: ChatMessage[];
  maxTokens: number;
}

export interface CompletionResult {
  text: string;
  finishReason: FinishReason;
  /** The provider's own stop reason, for logs. */
  rawStopReason: string | null;
  usage: UsageReport;
}

export interface ChatProvider {
  name: string;
  model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
  /** Streams the reply. Errors are thrown as ProviderError. */
  stream(request: CompletionRequest, options?: StreamOptions): AsyncIterable<ProviderEvent>;
}

/** What a provider stream yields: text pieces, then exactly one `done`. */
export type ProviderEvent =
  { type: 'text'; text: string } | ({ type: 'done' } & Omit<CompletionResult, 'text'>);

export interface StreamOptions {
  /** Aborting stops the upstream request, so no more tokens are billed. */
  signal?: AbortSignal;
}
