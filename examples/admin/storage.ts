/**
 * The dashboard's storage: one folder with `settings.json` and the knowledge
 * `.md` files, the layout `folderSource` reads. A real dashboard would use its
 * own database; only the shape handed to the source matters.
 */
import { cp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { KnowledgeDoc } from '@franyerhiguerey/ai-chat-ingest';
import type { SiteSettings } from '@franyerhiguerey/ai-chat-core';

/** Names the dashboard itself writes (see safeFileName). Anything else is refused. */
const DOC_NAME = /^[a-z0-9-]+\.md$/;

export const isDocName = (name: string) => DOC_NAME.test(name);

export function createStorage(dir: string, seedDir: string) {
  /** Writes through a temp file, so the chat never reads a half-written file. */
  async function writeAtomic(file: string, content: string) {
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, content);
    await rename(temp, file);
  }

  return {
    dir,

    /** Copies the seed on first run. */
    async init() {
      const exists = await stat(dir).then(
        () => true,
        () => false,
      );
      if (!exists) await cp(seedDir, dir, { recursive: true });
    },

    async readSettings(): Promise<unknown> {
      return JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8'));
    },

    saveSettings: (settings: SiteSettings) =>
      writeAtomic(path.join(dir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`),

    async listDocs(): Promise<{ file: string; chars: number }[]> {
      const names = (await readdir(dir)).filter((name) => DOC_NAME.test(name)).sort();
      return Promise.all(
        names.map(async (file) => ({
          file,
          chars: (await readFile(path.join(dir, file), 'utf8')).length,
        })),
      );
    },

    saveDoc: (doc: KnowledgeDoc) => {
      if (!DOC_NAME.test(doc.file)) throw new Error(`Refusing to write ${doc.file}`);
      return writeAtomic(path.join(dir, doc.file), `${doc.content}\n`);
    },

    async deleteDoc(file: string) {
      if (!DOC_NAME.test(file)) throw new Error(`Refusing to delete ${file}`);
      await rm(path.join(dir, file), { force: true });
    },
  };
}

export type Storage = ReturnType<typeof createStorage>;
