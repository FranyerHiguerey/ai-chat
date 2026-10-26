export {
  configSchema,
  defineConfig,
  loadEnv,
  ConfigError,
  DEFAULT_MODELS,
  LANGUAGES,
  PROVIDERS,
  type ChatConfig,
  type ChatConfigInput,
  type ChatEnv,
  type Language,
  type ProviderName,
} from './config.js';
export { loadKnowledge, KnowledgeError, type KnowledgeDoc } from './knowledge.js';
export { buildSystemPrompt } from './prompt.js';
export { createProvider } from './providers/index.js';
export { ProviderError, type ProviderErrorCode } from './errors.js';
export { STRINGS, pickLanguage, type Strings } from './i18n.js';
export {
  createChatClient,
  type AskOptions,
  type AskResult,
  type ChatClient,
  type ChatClientOptions,
  type ChatStreamEvent,
  type ChatStreamOptions,
} from './client.js';
export { createChatHandler, type ChatHandler, type ChatHandlerOptions } from './handler.js';
export { parseChatRequest, type ParsedChatRequest, type ParseResult } from './request.js';
export { encodeEvent, encodeComment } from './sse.js';
export * from './protocol.js';
export type {
  ChatMessage,
  ChatProvider,
  CompletionRequest,
  CompletionResult,
  FinishReason,
  ProviderEvent,
  StreamOptions,
  SystemPrompt,
  UsageReport,
} from './types.js';
