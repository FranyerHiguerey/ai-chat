import type { ChatEnv, ProviderName } from '../config.js';
import { ProviderError } from '../errors.js';
import type { ChatProvider } from '../types.js';

const PROVIDER_PACKAGES = {
  anthropic: '@anthropic-ai/sdk',
  openai: 'openai',
} as const satisfies Record<ProviderName, string>;

/**
 * Builds the provider chosen in the env. Each provider module is imported only
 * when selected, so a site installs just the SDK it uses.
 */
export async function createProvider(env: ChatEnv): Promise<ChatProvider> {
  try {
    switch (env.provider) {
      case 'anthropic': {
        const { createAnthropicProvider } = await import('./anthropic.js');
        return createAnthropicProvider({ apiKey: env.apiKey, model: env.model });
      }
      case 'openai': {
        const { createOpenAIProvider } = await import('./openai.js');
        return createOpenAIProvider({ apiKey: env.apiKey, model: env.model });
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      const pkg = PROVIDER_PACKAGES[env.provider];
      throw new ProviderError(
        'missing_sdk',
        `AI_CHAT_PROVIDER=${env.provider} needs the "${pkg}" package. Install it with: pnpm add ${pkg}`,
      );
    }
    throw error;
  }
}
