import { createHash } from 'node:crypto';
import { createChatClient, type ChatClient, type ChatClientOptions } from './client.js';
import {
  ConfigError,
  validateConfig,
  validateSiteSettings,
  type ChatConfig,
  type ValidationIssue,
} from './config.js';
import { createProvider } from './providers/index.js';
import type { ChatSource } from './source.js';
import type { ChatProvider } from './types.js';

/** A ready chat client and the config it was built from. */
export interface Build {
  config: ChatConfig;
  chat: ChatClient;
}

export interface BuilderOptions extends ChatClientOptions {
  source?: ChatSource;
  /** A rebuild failed; the previous build keeps serving. */
  onStale: (error: unknown) => void;
}

/**
 * Keeps the current chat client. Without a source it is built once, from
 * `config` and its knowledge folder. With a source, every call loads the
 * source and rebuilds only when the content hash changes, so the system
 * prompt bytes (and the provider's prompt cache) stay put between edits.
 */
export function createBuilder(options: BuilderOptions) {
  const { config: base, source, onStale } = options;
  let provider: Promise<ChatProvider> | undefined;
  let current: { hash: string; build: Build } | undefined;
  let pending: { hash: string; promise: Promise<Build> } | undefined;
  // A hash that failed to build: not retried on every request, only when the content changes again.
  let failedHash: string | undefined;

  const getProvider = () => {
    provider ??= (
      options.provider ? Promise.resolve(options.provider) : createProvider(options.env)
    ).catch((error: unknown) => {
      provider = undefined;
      throw error;
    });
    return provider;
  };

  const build = async (config: ChatConfig, knowledge?: ChatClientOptions['knowledge']) => {
    const chat = await createChatClient({
      ...options,
      config,
      knowledge,
      provider: await getProvider(),
    });
    return { config, chat };
  };

  async function load(): Promise<{ hash: string; make: () => Promise<Build> }> {
    if (!source) return { hash: 'static', make: () => build(base) };

    const data = await source.load();
    let config = base;
    if (data.settings !== undefined) {
      // Validating the settings alone drops any keys a dashboard has no say over (limits, origins...).
      const settings = validateSiteSettings(data.settings);
      if (!settings.ok) throw settingsError(settings.issues);
      const merged = validateConfig({ ...base, ...settings.value });
      if (!merged.ok) throw settingsError(merged.issues);
      config = merged.value;
    }
    const hash = createHash('sha256')
      .update(JSON.stringify([config, data.knowledge]))
      .digest('hex');
    return { hash, make: () => build(config, data.knowledge) };
  }

  return {
    /** The config currently served; the base config until the first build. */
    get config(): ChatConfig {
      return current?.build.config ?? base;
    },

    async current(): Promise<Build> {
      let next: Awaited<ReturnType<typeof load>>;
      try {
        next = await load();
      } catch (error) {
        if (!current) throw error;
        onStale(error);
        return current.build;
      }
      if (current?.hash === next.hash) return current.build;
      if (current && failedHash === next.hash) return current.build;

      let attempt = pending?.hash === next.hash ? pending : undefined;
      if (!attempt) {
        const hash = next.hash;
        const promise = next.make().then(
          (built) => {
            current = { hash, build: built };
            failedHash = undefined;
            return built;
          },
          (error: unknown) => {
            failedHash = hash;
            throw error;
          },
        );
        attempt = pending = { hash, promise };
        promise
          .then(
            () => {},
            () => {},
          )
          .finally(() => {
            if (pending?.hash === hash) pending = undefined;
          });
      }

      try {
        return await attempt.promise;
      } catch (error) {
        if (!current) {
          failedHash = undefined; // nothing to fall back on: let the next request retry
          throw error;
        }
        onStale(error);
        return current.build;
      }
    },
  };
}

function settingsError(issues: ValidationIssue[]): ConfigError {
  const list = issues.map((issue) => `${issue.path || '(root)'}: ${issue.message}`).join('; ');
  return new ConfigError(`Invalid site settings: ${list}`);
}
