import { describe, expect, it } from 'vitest';
import { parseBlocks, renderMarkdown, safeUrl } from './markdown.js';

const html = (source: string): string => {
  const div = document.createElement('div');
  div.append(renderMarkdown(source));
  return div.innerHTML;
};

describe('parseBlocks', () => {
  it('splits paragraphs, lists, headings and code', () => {
    const source =
      '## Envíos\nLlegan en **3 días**.\nCon seguimiento.\n\n- Uno\n- Dos\n\n1. A\n2. B\n```\nx < y\n```';
    expect(parseBlocks(source)).toEqual([
      { type: 'heading', text: 'Envíos' },
      { type: 'paragraph', lines: ['Llegan en **3 días**.', 'Con seguimiento.'] },
      { type: 'list', ordered: false, start: 1, items: ['Uno', 'Dos'] },
      { type: 'list', ordered: true, start: 1, items: ['A', 'B'] },
      { type: 'code', text: 'x < y' },
    ]);
  });

  it('joins indented continuation lines and flattens nested bullets', () => {
    expect(parseBlocks('- one\n  still one\n  - nested')).toEqual([
      { type: 'list', ordered: false, start: 1, items: ['one still one', 'nested'] },
    ]);
  });

  it('keeps the start of numbered lists and skips rules', () => {
    expect(parseBlocks('3. three\n---\n4) four')).toEqual([
      { type: 'list', ordered: true, start: 3, items: ['three'] },
      { type: 'list', ordered: true, start: 4, items: ['four'] },
    ]);
  });

  it('runs an unclosed fence to the end (mid-stream)', () => {
    expect(parseBlocks('```\ncode')).toEqual([{ type: 'code', text: 'code' }]);
  });
});

describe('renderMarkdown', () => {
  it('renders inline formatting', () => {
    expect(html('**bold** and *em* and `code`')).toBe(
      '<p><strong>bold</strong> and <em>em</em> and <code>code</code></p>',
    );
  });

  it('renders line breaks, lists and headings', () => {
    expect(html('# Title\na\nb\n\n- x\n- **y**')).toBe(
      '<p><strong>Title</strong></p><p>a<br>b</p><ul><li>x</li><li><strong>y</strong></li></ul>',
    );
  });

  it('renders safe links that open in a new tab', () => {
    expect(html('[Site](https://example.com/a) or https://example.com/b.')).toBe(
      '<p><a href="https://example.com/a" target="_blank" rel="noopener noreferrer">Site</a> or ' +
        '<a href="https://example.com/b" target="_blank" rel="noopener noreferrer">https://example.com/b</a>.</p>',
    );
    expect(html('[Write](mailto:a@b.co)')).toBe('<p><a href="mailto:a@b.co">Write</a></p>');
  });

  it('leaves multiplication and lone asterisks alone', () => {
    expect(html('2 * 3 * 4')).toBe('<p>2 * 3 * 4</p>');
  });

  describe('safety', () => {
    it('shows raw HTML as text', () => {
      const out = html('<img src=x onerror="alert(1)"> <script>alert(1)</script>');
      expect(out).not.toContain('<img');
      expect(out).not.toContain('<script');
      expect(out).toContain('&lt;img');
    });

    it.each([
      '[x](javascript:alert(1))',
      '[x](JAVASCRIPT:alert(1))',
      '[x](data:text/html,<script>alert(1)</script>)',
      '[x](vbscript:msgbox)',
      '[x](/relative)',
    ])('drops the link but keeps the text: %s', (source) => {
      const div = document.createElement('div');
      div.append(renderMarkdown(source));
      expect(div.querySelector('a')).toBeNull();
      expect(div.textContent).toContain('x');
    });

    it('never nests links', () => {
      const div = document.createElement('div');
      div.append(renderMarkdown('[see https://a.com](https://b.com)'));
      expect(div.querySelectorAll('a')).toHaveLength(1);
    });
  });
});

describe('safeUrl', () => {
  it('keeps http(s), mailto and tel', () => {
    expect(safeUrl('https://wa.me/584121234567')).toBe('https://wa.me/584121234567');
    expect(safeUrl('tel:+584121234567')).toBe('tel:+584121234567');
  });

  it('rejects other protocols and relative URLs', () => {
    expect(safeUrl(' javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('/contact')).toBeUndefined();
  });
});
