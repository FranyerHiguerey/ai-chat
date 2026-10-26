import type { ValidationIssue } from '@franyerhiguerey/ai-chat-core';
import { html, type Html } from './html.js';

/** The settings form's fields. `name` is the dotted path in the site settings. */
const FIELDS: {
  name: string;
  label: string;
  type?: 'textarea' | 'lines' | 'language';
  hint?: string;
}[] = [
  { name: 'company.name', label: 'Company name' },
  { name: 'company.description', label: 'What the company does', type: 'textarea' },
  { name: 'company.website', label: 'Website', hint: 'https://…' },
  { name: 'company.contact.email', label: 'Contact email' },
  {
    name: 'company.contact.whatsapp',
    label: 'WhatsApp',
    hint: 'International format, e.g. +584121234567',
  },
  { name: 'company.hours', label: 'Business hours' },
  { name: 'languages.default', label: 'Default language', type: 'language' },
  { name: 'languages.tone', label: 'Tone', hint: 'e.g. Friendly and professional' },
  { name: 'widget.name', label: 'Assistant name' },
  { name: 'widget.greeting.es', label: 'Greeting (Spanish)' },
  { name: 'widget.greeting.en', label: 'Greeting (English)' },
  {
    name: 'widget.starters.es',
    label: 'Starter questions (Spanish)',
    type: 'lines',
    hint: 'One per line',
  },
  {
    name: 'widget.starters.en',
    label: 'Starter questions (English)',
    type: 'lines',
    hint: 'One per line',
  },
  {
    name: 'widget.handoff.href',
    label: '"Talk to a person" link',
    hint: 'https://wa.me/… or mailto:…',
  },
];

function get(source: unknown, dotted: string): unknown {
  return dotted
    .split('.')
    .reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], source);
}

function set(target: Record<string, unknown>, dotted: string, value: unknown): void {
  const keys = dotted.split('.');
  const last = keys.pop()!;
  let node = target;
  for (const key of keys) node = (node[key] ??= {}) as Record<string, unknown>;
  node[last] = value;
}

/** The form back into site settings. Empty fields are left out, so optional settings stay unset. */
export function formToSettings(form: FormData): Record<string, unknown> {
  const settings: Record<string, unknown> = { languages: { supported: ['es', 'en'] } };
  for (const field of FIELDS) {
    const raw = form.get(field.name);
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) continue;
    if (field.type === 'lines') {
      const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length) set(settings, field.name, lines);
    } else {
      set(settings, field.name, text);
    }
  }
  return settings;
}

function fieldValue(settings: unknown, name: string): string {
  const value = get(settings, name);
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : ((item as { label?: string }).label ?? '')))
      .join('\n');
  }
  // A greeting given as one string for both languages shows in each language's field.
  if (value === undefined && /\.(es|en)$/.test(name)) {
    const shared = get(settings, name.slice(0, -3));
    if (typeof shared === 'string') return shared;
  }
  return typeof value === 'string' ? value : '';
}

/** The issue that belongs to a field: its own path, or the object it sits in. */
const issueFor = (issues: ValidationIssue[], name: string) =>
  issues.find((issue) => issue.path && (name === issue.path || name.startsWith(`${issue.path}.`)));

function layout(title: string, current: string, body: Html): Html {
  const nav = [
    ['/admin', 'Settings'],
    ['/admin/knowledge', 'Knowledge'],
    ['/admin/preview', 'Preview'],
  ].map(
    ([href, label]) =>
      html`<a href="${href}" ${href === current ? html`aria-current="page"` : ''}>${label}</a>`,
  );

  return html`<html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title} · ai-chat admin</title>
      <style>
        :root {
          --bg: #f6f7f9;
          --surface: #fff;
          --text: #16181d;
          --muted: #5f6673;
          --border: #dfe3e8;
          --accent: #2f5bd3;
          --danger: #b42318;
          color-scheme: light;
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --bg: #0f1115;
            --surface: #171a21;
            --text: #e7e9ee;
            --muted: #9aa1ad;
            --border: #2a2f3a;
            --accent: #7d9cf0;
            --danger: #f97066;
            color-scheme: dark;
          }
        }
        * {
          box-sizing: border-box;
        }
        body {
          margin: 0;
          font:
            15px/1.5 system-ui,
            sans-serif;
          background: var(--bg);
          color: var(--text);
        }
        header {
          display: flex;
          gap: 20px;
          align-items: center;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border);
          background: var(--surface);
          flex-wrap: wrap;
        }
        header strong {
          margin-right: auto;
        }
        header a {
          color: var(--muted);
          text-decoration: none;
        }
        header a[aria-current] {
          color: var(--text);
          font-weight: 600;
        }
        main {
          max-width: 720px;
          margin: 0 auto;
          padding: 24px 16px 64px;
        }
        h1 {
          font-size: 22px;
          margin: 0 0 16px;
        }
        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 20px;
          margin-bottom: 20px;
        }
        label {
          display: block;
          font-weight: 600;
          margin: 14px 0 4px;
        }
        label:first-child {
          margin-top: 0;
        }
        input,
        textarea,
        select {
          width: 100%;
          font: inherit;
          padding: 8px 10px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--bg);
          color: var(--text);
        }
        textarea {
          min-height: 70px;
        }
        .hint {
          color: var(--muted);
          font-size: 13px;
        }
        .error {
          color: var(--danger);
          font-size: 13px;
          margin-top: 4px;
        }
        .notice {
          padding: 10px 14px;
          border-radius: 8px;
          border: 1px solid var(--border);
          margin-bottom: 16px;
        }
        .notice--error {
          border-color: var(--danger);
          color: var(--danger);
        }
        button {
          font: inherit;
          padding: 8px 16px;
          border-radius: 6px;
          border: 0;
          background: var(--accent);
          color: #fff;
          cursor: pointer;
          margin-top: 16px;
        }
        button.link {
          background: none;
          color: var(--danger);
          padding: 0;
          margin: 0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        td {
          padding: 8px 0;
          border-bottom: 1px solid var(--border);
        }
        td:last-child {
          text-align: right;
        }
        pre {
          overflow-x: auto;
          background: var(--bg);
          padding: 12px;
          border-radius: 6px;
          font-size: 13px;
        }
      </style>
    </head>
    <body>
      <header><strong>ai-chat admin</strong>${nav}</header>
      <main>${body}</main>
    </body>
  </html>`;
}

export function settingsPage(
  settings: unknown,
  issues: ValidationIssue[] = [],
  saved = false,
): Html {
  const fields = FIELDS.map((field) => {
    const value = fieldValue(settings, field.name);
    const issue = issueFor(issues, field.name);
    const control =
      field.type === 'language'
        ? html`<select id="${field.name}" name="${field.name}">
            ${['es', 'en'].map((lang) => html`<option value="${lang}" ${value === lang ? html`selected` : ''}>${lang}</option>`)}
          </select>`
        : field.type
          ? html`<textarea id="${field.name}" name="${field.name}">${value}</textarea>`
          : html`<input id="${field.name}" name="${field.name}" value="${value}" />`;
    return html`<label for="${field.name}">${field.label}</label>${control}
      ${field.hint ? html`<div class="hint">${field.hint}</div>` : ''}
      ${issue ? html`<div class="error">${issue.message}</div>` : ''}`;
  });
  const unplaced = issues.filter((issue) => !FIELDS.some((field) => issueFor([issue], field.name)));

  return layout(
    'Settings',
    '/admin',
    html`<h1>Settings</h1>
      ${saved ? html`<div class="notice">Saved. The chat uses the new settings within a few seconds.</div>` : ''}
      ${issues.length ? html`<div class="notice notice--error">Fix the highlighted fields.${unplaced.map((i) => html`<br />${i.path}: ${i.message}`)}</div>` : ''}
      <form method="post" class="card">${fields}<button>Save</button></form>`,
  );
}

export function knowledgePage(
  docs: { file: string; chars: number }[],
  maxChars: number,
  messages: { ok: string[]; errors: string[] } = { ok: [], errors: [] },
): Html {
  const total = docs.reduce((sum, doc) => sum + doc.chars, 0);
  return layout(
    'Knowledge',
    '/admin/knowledge',
    html`<h1>Knowledge</h1>
      ${messages.ok.map((m) => html`<div class="notice">${m}</div>`)}
      ${messages.errors.map((m) => html`<div class="notice notice--error">${m}</div>`)}
      <form method="post" action="/admin/knowledge" enctype="multipart/form-data" class="card">
        <label for="files">Upload documents</label>
        <input
          id="files"
          type="file"
          name="files"
          multiple
          accept=".md,.txt,.html,.htm,.pdf,.docx"
        />
        <div class="hint">
          Markdown, text, HTML, PDF or Word. They're converted to text when you upload.
        </div>
        <button>Upload</button>
      </form>
      <div class="card">
        <table>
          ${docs.map(
            (doc) =>
              html`<tr>
                <td>${doc.file}</td>
                <td class="hint">${doc.chars.toLocaleString('en')} chars</td>
                <td>
                  <form method="post" action="/admin/knowledge/delete">
                    <input type="hidden" name="file" value="${doc.file}" />
                    <button class="link">Delete</button>
                  </form>
                </td>
              </tr>`,
          )}
        </table>
        <p class="hint">
          ${total.toLocaleString('en')} of ${maxChars.toLocaleString('en')} characters used. Every
          chat sends all of it, so shorter is cheaper.
        </p>
      </div>`,
  );
}

export function previewPage(origin: string): Html {
  const snippet = `<script src="${origin}/widget.js" defer></script>\n<ai-chat endpoint="${origin}/api/chat" remote-config></ai-chat>`;
  return layout(
    'Preview',
    '/admin/preview',
    html`<h1>Preview</h1>
      <div class="card">
        <p>
          The assistant in the corner reads its name, greeting and starters from the settings.
          Chatting uses the provider in <code>.env</code> and costs tokens.
        </p>
        <label>Embed on your site</label>
        <pre>${snippet}</pre>
        <p class="hint">
          Another site must also be listed in <code>allowedOrigins</code> in the deploy config.
        </p>
      </div>
      <script src="/widget.js" defer></script>
      <ai-chat endpoint="/api/chat" remote-config></ai-chat>`,
  );
}
