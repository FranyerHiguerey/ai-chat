type Attrs = Record<string, string | boolean | undefined>;
type Child = Node | string | false | null | undefined;

/** Creates an element. `true` sets an empty attribute; `false` and `undefined` skip it. Strings become text nodes. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === true) el.setAttribute(name, '');
    else if (typeof value === 'string') el.setAttribute(name, value);
  }
  for (const child of children) {
    if (child !== false && child !== null && child !== undefined) el.append(child);
  }
  return el;
}

/** Hidden on screen, read by screen readers. */
export const srOnly = (text: string): HTMLSpanElement => h('span', { class: 'sr-only' }, text);
