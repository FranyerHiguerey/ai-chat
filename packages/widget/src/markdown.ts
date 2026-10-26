/**
 * Renders the markdown subset assistants use: paragraphs, headings (as bold
 * lines), bullet and numbered lists, fenced code, **bold**, *italic*, `code`,
 * [links](https://…) and bare URLs.
 *
 * Safe by construction: text only ever enters the DOM as text nodes, so raw
 * HTML in a reply shows up as text, and links are kept only for http(s),
 * mailto and tel URLs.
 */

export type Block =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'heading'; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: string[] }
  | { type: 'code'; text: string };

type ListBlock = Extract<Block, { type: 'list' }>;

const FENCE = /^\s*```/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+•]\s+(.*)$/;
const ORDERED = /^\s*(\d{1,4})[.)]\s+(.*)$/;

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] | undefined;
  let list: ListBlock | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;

    if (FENCE.test(line)) {
      paragraph = list = undefined;
      const code: string[] = [];
      // An unclosed fence (mid-stream) runs to the end.
      while (++i < lines.length && !FENCE.test(lines[i] as string)) code.push(lines[i] as string);
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    if (!line.trim() || RULE.test(line)) {
      paragraph = list = undefined;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      paragraph = list = undefined;
      blocks.push({ type: 'heading', text: heading[1] as string });
      continue;
    }
    const ordered = ORDERED.exec(line);
    const bullet = ordered ? null : BULLET.exec(line);
    if (ordered || bullet) {
      paragraph = undefined;
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        list = {
          type: 'list',
          ordered: isOrdered,
          start: ordered ? Number(ordered[1]) : 1,
          items: [],
        };
        blocks.push(list);
      }
      list.items.push((ordered ? ordered[2] : bullet?.[1]) as string);
      continue;
    }
    if (list && /^\s/.test(line)) {
      // An indented line continues the previous item.
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last]} ${line.trim()}`;
      continue;
    }
    list = undefined;
    if (!paragraph) {
      paragraph = [];
      blocks.push({ type: 'paragraph', lines: paragraph });
    }
    paragraph.push(line.trim());
  }
  return blocks;
}

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** The normalized URL if it is absolute and uses a safe protocol, otherwise undefined. */
export function safeUrl(href: string): string | undefined {
  try {
    const url = new URL(href);
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// One alternative per inline form; the first group that matched tells which.
const INLINE =
  /`([^`\n]+)`|\*\*(?=\S)([^\n]*?\S)\*\*|\[([^\]\n]+)\]\(\s*([^)\s]+)\s*\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"*])|\*(?=[^\s*])([^*\n]*?[^\s*])\*/g;

function appendInline(parent: Node, text: string, allowLinks = true): void {
  const doc = parent.ownerDocument ?? document;
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) parent.appendChild(doc.createTextNode(text.slice(last, index)));
    last = index + match[0].length;

    const [whole, code, bold, label, href, bare, italic] = match;
    if (code !== undefined) {
      parent.appendChild(doc.createElement('code')).textContent = code;
    } else if (bold !== undefined) {
      appendInline(parent.appendChild(doc.createElement('strong')), bold, allowLinks);
    } else if (label !== undefined) {
      const url = allowLinks ? safeUrl(href as string) : undefined;
      appendInline(url ? parent.appendChild(link(doc, url)) : parent, label, false);
    } else if (bare !== undefined) {
      const url = allowLinks ? safeUrl(bare) : undefined;
      if (url) parent.appendChild(link(doc, url)).textContent = bare;
      else parent.appendChild(doc.createTextNode(whole));
    } else if (italic !== undefined) {
      appendInline(parent.appendChild(doc.createElement('em')), italic, allowLinks);
    }
  }
  if (last < text.length) parent.appendChild(doc.createTextNode(text.slice(last)));
}

function link(doc: Document, url: string): HTMLAnchorElement {
  const a = doc.createElement('a');
  a.href = url;
  if (!url.startsWith('mailto:') && !url.startsWith('tel:')) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  return a;
}

export function renderMarkdown(source: string, doc: Document = document): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  for (const block of parseBlocks(source)) {
    switch (block.type) {
      case 'paragraph': {
        const p = fragment.appendChild(doc.createElement('p'));
        block.lines.forEach((line, index) => {
          if (index > 0) p.appendChild(doc.createElement('br'));
          appendInline(p, line);
        });
        break;
      }
      case 'heading': {
        const p = fragment.appendChild(doc.createElement('p'));
        appendInline(p.appendChild(doc.createElement('strong')), block.text);
        break;
      }
      case 'list': {
        const list = fragment.appendChild(doc.createElement(block.ordered ? 'ol' : 'ul'));
        if (block.ordered && block.start !== 1) list.setAttribute('start', String(block.start));
        for (const item of block.items)
          appendInline(list.appendChild(doc.createElement('li')), item);
        break;
      }
      case 'code': {
        const pre = fragment.appendChild(doc.createElement('pre'));
        pre.appendChild(doc.createElement('code')).textContent = block.text;
        break;
      }
    }
  }
  return fragment;
}
