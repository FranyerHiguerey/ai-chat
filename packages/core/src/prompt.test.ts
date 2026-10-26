import { describe, expect, it } from 'vitest';
import { loadKnowledge } from './knowledge.js';
import { buildSystemPrompt } from './prompt.js';
import { FIXTURE_KNOWLEDGE, testConfig } from '../test/helpers.js';

describe('buildSystemPrompt', () => {
  it('produces identical bytes for the same input', async () => {
    const a = buildSystemPrompt(testConfig(), await loadKnowledge(FIXTURE_KNOWLEDGE));
    const b = buildSystemPrompt(testConfig(), await loadKnowledge(FIXTURE_KNOWLEDGE));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('includes company info and every document in order', async () => {
    const system = buildSystemPrompt(testConfig(), await loadKnowledge(FIXTURE_KNOWLEDGE));
    const { knowledge } = system;
    expect(knowledge).toContain('Name: Acme Plastics');
    expect(knowledge).toContain('WhatsApp: +584121234567');
    const order = ['10.md', 'a.md', 'b.md'].map((file) =>
      knowledge.indexOf(`<document source="${file}">`),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('follows the configured languages and tone', () => {
    const config = testConfig({
      languages: { supported: ['en'], default: 'en', tone: 'Friendly and concise.' },
    });
    const instructions = buildSystemPrompt(config, [{ file: 'a.md', content: 'x' }]).instructions;
    expect(instructions).toContain(
      "visitor's language when it is English; otherwise reply in English",
    );
    expect(instructions).toContain('Tone: Friendly and concise.');
  });

  it('contains nothing that changes between calls', () => {
    const { instructions, knowledge } = buildSystemPrompt(testConfig(), [
      { file: 'a.md', content: 'x' },
    ]);
    const text = `${instructions}\n${knowledge}`;
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
