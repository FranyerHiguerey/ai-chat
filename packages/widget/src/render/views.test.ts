import { describe, expect, it } from 'vitest';
import { STRINGS } from '../i18n.js';
import { initials, renderDraft } from './views.js';

describe('initials', () => {
  it('takes the first letters of the first two words', () => {
    expect(initials('Your Brand')).toBe('YB');
    expect(initials('Ríos & Asociados')).toBe('RA');
    expect(initials('nimbus')).toBe('N');
    expect(initials('  ')).toBe('?');
  });
});

describe('renderDraft', () => {
  it('shows typing dots before any text', () => {
    const bubble = document.createElement('div');
    renderDraft(bubble, '', STRINGS.en);
    expect(bubble.querySelector('.dots')?.getAttribute('role')).toBe('status');
  });

  it('puts the caret after the last text', () => {
    const bubble = document.createElement('div');
    renderDraft(bubble, 'In **3 days** after', STRINGS.en);
    expect(bubble.querySelector('p')?.lastChild).toBe(bubble.querySelector('.caret'));
    renderDraft(bubble, '- one\n- **two**', STRINGS.en);
    expect(bubble.querySelector('li:last-child strong .caret')).not.toBeNull();
  });
});
