import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeError, loadKnowledge } from './knowledge.js';
import { FIXTURE_KNOWLEDGE } from '../test/helpers.js';

describe('loadKnowledge', () => {
  let tmp: string | undefined;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it('loads top-level .md files sorted by code unit, ignoring other files and subfolders', async () => {
    const docs = await loadKnowledge(FIXTURE_KNOWLEDGE);
    expect(docs.map((doc) => doc.file)).toEqual(['10.md', 'a.md', 'b.md']);
  });

  it('normalizes line endings and trims', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'ai-chat-'));
    await writeFile(path.join(tmp, 'faq.md'), '\r\n# FAQ\r\n\r\nLine\rTwo\r\n');
    const [doc] = await loadKnowledge(tmp);
    expect(doc?.content).toBe('# FAQ\n\nLine\nTwo');
  });

  it('throws when the folder is missing', async () => {
    await expect(loadKnowledge('/does/not/exist')).rejects.toThrow(KnowledgeError);
  });

  it('throws when the folder has no markdown', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'ai-chat-'));
    await writeFile(path.join(tmp, 'notes.txt'), 'hi');
    await expect(loadKnowledge(tmp)).rejects.toThrow(/No \.md files/);
  });
});
