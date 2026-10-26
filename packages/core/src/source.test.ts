import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedSource, folderSource, staticSource, type SourceData } from './source.js';

const DATA: SourceData = { knowledge: [{ file: 'faq.md', content: 'Q: ¿Envíos? A: Sí.' }] };

describe('staticSource', () => {
  it('returns the data, or calls the function each time', async () => {
    expect(await staticSource(DATA).load()).toBe(DATA);
    const fetchData = vi.fn(async () => DATA);
    const source = staticSource(fetchData);
    await source.load();
    await source.load();
    expect(fetchData).toHaveBeenCalledTimes(2);
  });
});

describe('folderSource', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ai-chat-source-'));
    await writeFile(path.join(dir, 'faq.md'), '# FAQ\r\nSí.');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('reads the markdown files, without settings when there is no settings.json', async () => {
    expect(await folderSource({ dir }).load()).toEqual({
      knowledge: [{ file: 'faq.md', content: '# FAQ\nSí.' }],
    });
  });

  it('reads settings.json and leaves it out of the knowledge', async () => {
    const settings = { company: { name: 'Acme', description: 'Envases.' } };
    await writeFile(path.join(dir, 'settings.json'), JSON.stringify(settings));
    const data = await folderSource({ dir }).load();
    expect(data.settings).toEqual(settings);
    expect(data.knowledge.map((doc) => doc.file)).toEqual(['faq.md']);
  });

  it('fails on malformed settings.json', async () => {
    await writeFile(path.join(dir, 'settings.json'), '{oops');
    await expect(folderSource({ dir }).load()).rejects.toThrow(SyntaxError);
  });
});

describe('cachedSource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reuses a load for the TTL and shares one in-flight load', async () => {
    const load = vi.fn(async () => DATA);
    const source = cachedSource({ load }, { ttlMs: 1000 });
    await Promise.all([source.load(), source.load()]);
    await source.load();
    expect(load).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    await source.load();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps serving the last good data when a reload fails', async () => {
    const onError = vi.fn();
    const load = vi.fn<() => Promise<SourceData>>().mockResolvedValueOnce(DATA);
    load.mockRejectedValueOnce(new Error('db down'));
    const source = cachedSource({ load }, { ttlMs: 1000, onError });

    await source.load();
    vi.advanceTimersByTime(1000);
    expect(await source.load()).toBe(DATA);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'db down' }));
  });

  it('throws when the very first load fails', async () => {
    const source = cachedSource(
      { load: () => Promise.reject(new Error('db down')) },
      { ttlMs: 1000 },
    );
    await expect(source.load()).rejects.toThrow('db down');
  });
});
