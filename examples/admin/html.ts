/** HTML built from template literals. Every interpolated value is escaped unless it is already `Html`. */
export class Html {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

type Value = Html | string | number | boolean | null | undefined | Value[];

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

function render(value: Value): string {
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return escape(String(value));
}

export function html(strings: TemplateStringsArray, ...values: Value[]): Html {
  return new Html(
    strings.reduce((out, part, i) => out + part + (i < values.length ? render(values[i]) : ''), ''),
  );
}

export const page = (body: Html, status = 200): Response =>
  new Response(`<!doctype html>${body.value}`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
