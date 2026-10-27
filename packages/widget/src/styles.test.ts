import { describe, expect, it } from 'vitest';
import { styles } from './styles.js';

/** The declarations of one rule, e.g. `.items { ... }`. */
const rule = (selector: string) => {
  const match = new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(
    styles,
  );
  return match?.[1] ?? '';
};

describe('styles: scrolling', () => {
  it('lets a vertical wheel over the product cards reach the conversation', () => {
    // The row scrolls sideways only. `overscroll-behavior: contain` (both axes)
    // swallowed vertical wheel input over the cards: neither the chat nor the
    // page moved (seen in real Chrome). Contain the x axis only.
    const items = rule('.items');
    expect(items).toContain('overscroll-behavior-x: contain');
    expect(items).not.toMatch(/overscroll-behavior:\s*(contain|none)/);
    expect(items).not.toMatch(/overscroll-behavior-y:\s*(contain|none)/);
  });

  it('keeps the conversation from chaining scroll into the page', () => {
    expect(styles).toMatch(/overflow-y: auto; overscroll-behavior: contain/);
  });
});
