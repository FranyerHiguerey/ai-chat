import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CatalogItemInput } from './catalog.js';
import type { SiteSettingsInput } from './config.js';
import { loadKnowledge, type KnowledgeDoc } from './knowledge.js';

/** What a dashboard or CMS supplies: the owner-editable settings and the knowledge. */
export interface SourceData {
  /** Overrides `company`, `languages` and `widget` from the handler's config. */
  settings?: SiteSettingsInput;
  knowledge: KnowledgeDoc[];
  /** Replaces `config.catalog`. Searched by the assistant, shown as product cards. */
  catalog?: CatalogItemInput[];
}

/**
 * Where the bot's content comes from. The handler calls `load()` on every chat
 * request and rebuilds the system prompt only when the content changed, so a
 * source must return the same data for the same content (no dates or random IDs).
 * Wrap slow sources in `cachedSource`.
 */
export interface ChatSource {
  load(): Promise<SourceData>;
}

/** Data the site already has, or a function that fetches it (e.g. from its database). */
export function staticSource(
  data: SourceData | (() => SourceData | Promise<SourceData>),
): ChatSource {
  return { load: async () => (typeof data === 'function' ? data() : data) };
}

/**
 * A folder written by a dashboard: optional `settings.json` and `catalog.json`, plus `.md` files.
 * Reads the disk on every load, so wrap it in `cachedSource`.
 */
export function folderSource({ dir }: { dir: string }): ChatSource {
  return {
    async load() {
      const [settings, catalog, knowledge] = await Promise.all([
        readJson<SiteSettingsInput>(path.join(dir, 'settings.json')),
        readJson<CatalogItemInput[]>(path.join(dir, 'catalog.json')),
        loadKnowledge(dir),
      ]);
      return { knowledge, ...(settings && { settings }), ...(catalog && { catalog }) };
    },
  };
}

async function readJson<T>(file: string): Promise<T | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  // Shape is checked when the chat is built, which reports what's invalid.
  return JSON.parse(raw) as T;
}

export interface CachedSourceOptions {
  /** How long a load is reused. */
  ttlMs: number;
  /** Called when a reload fails and the last good data is served instead. */
  onError?: (error: unknown) => void;
}

/**
 * Loads at most once per `ttlMs`; callers arriving during a load share it. When
 * a reload fails (the database is down, a file is half-written), the last good
 * data keeps being served, so the bot stays up. The first load's failure is thrown.
 */
export function cachedSource(source: ChatSource, options: CachedSourceOptions): ChatSource {
  const { ttlMs, onError = warnSourceError } = options;
  let last: { data: SourceData; at: number } | undefined;
  let inFlight: Promise<SourceData> | undefined;

  const reload = async () => {
    try {
      const data = await source.load();
      last = { data, at: Date.now() };
      return data;
    } catch (error) {
      if (!last) throw error;
      onError(error);
      last = { data: last.data, at: Date.now() }; // retry after another TTL, not on every request
      return last.data;
    } finally {
      inFlight = undefined;
    }
  };

  return {
    load() {
      if (last && Date.now() - last.at < ttlMs) return Promise.resolve(last.data);
      inFlight ??= reload();
      return inFlight;
    },
  };
}

function warnSourceError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(JSON.stringify({ event: 'ai-chat.error', stage: 'source', message }));
}
