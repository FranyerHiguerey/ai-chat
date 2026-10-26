import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface KnowledgeDoc {
  /** File name relative to the knowledge folder, e.g. `faq.md`. */
  file: string;
  content: string;
}

export class KnowledgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeError';
  }
}

/**
 * Loads every `.md` file in `dir` (not recursive), sorted by file name.
 *
 * Ordering uses a plain code-unit compare rather than `localeCompare`, so the
 * result never depends on the machine's locale. Together with line-ending
 * normalization this keeps the system prompt byte-identical across deploys,
 * which prompt caching needs.
 */
export async function loadKnowledge(dir: string): Promise<KnowledgeDoc[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new KnowledgeError(`Knowledge folder not found: ${dir}`);
    }
    throw error;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (files.length === 0) {
    throw new KnowledgeError(`No .md files found in knowledge folder: ${dir}`);
  }

  return Promise.all(
    files.map(async (file) => {
      const raw = await readFile(path.join(dir, file), 'utf8');
      return { file, content: raw.replace(/\r\n?/g, '\n').trim() };
    }),
  );
}
