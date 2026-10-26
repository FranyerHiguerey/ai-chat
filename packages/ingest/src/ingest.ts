import { IngestError } from './errors.js';
import { htmlToText } from './html.js';

/** The same shape as ai-chat-core's `KnowledgeDoc`, so the output can be handed to a source. */
export interface KnowledgeDoc {
  file: string;
  content: string;
}

export interface UploadedFile {
  /** The original file name; its extension picks the parser. */
  name: string;
  /** MIME type, used when the name has no known extension. */
  type?: string;
  bytes: Uint8Array;
}

export interface IngestOptions {
  /** Default 10 MB. */
  maxBytes?: number;
}

type Kind = 'markdown' | 'text' | 'html' | 'pdf' | 'docx';

const BY_EXTENSION: Record<string, Kind> = {
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  html: 'html',
  htm: 'html',
  pdf: 'pdf',
  docx: 'docx',
};

const BY_MIME: Record<string, Kind> = {
  'text/markdown': 'markdown',
  'text/plain': 'text',
  'text/html': 'html',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

function kindOf(file: UploadedFile): Kind | undefined {
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  return (extension && BY_EXTENSION[extension]) || BY_MIME[file.type?.split(';')[0]?.trim() ?? ''];
}

/**
 * A file name that is safe to write anywhere: lowercase ASCII words joined by
 * dashes, always ending in `.md`. Path separators, dots and accents can't
 * survive it, so `../../etc/passwd` becomes `etc-passwd.md`.
 */
export function safeFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  const slug = base
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return `${slug || 'document'}.md`;
}

/**
 * Converts an uploaded file to a knowledge document. Run it when the owner
 * uploads, not during a chat: PDF and DOCX parsing is slow, and storing the
 * text keeps the bot's prompt fast and identical between requests.
 */
export async function toKnowledgeDoc(
  file: UploadedFile,
  options: IngestOptions = {},
): Promise<KnowledgeDoc> {
  const { maxBytes = 10 * 1024 * 1024 } = options;
  if (file.bytes.byteLength > maxBytes) {
    throw new IngestError('too_large', `${file.name} is over ${maxBytes} bytes`);
  }
  const kind = kindOf(file);
  if (!kind) {
    throw new IngestError('unsupported_type', `${file.name}: use .md, .txt, .html, .pdf or .docx`);
  }

  const raw = await extract(kind, file.bytes);
  const content = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (content === '') {
    const hint = kind === 'pdf' ? ' (a scanned PDF has no text layer; export it with text)' : '';
    throw new IngestError('empty', `${file.name} has no text${hint}`);
  }
  return { file: safeFileName(file.name), content };
}

async function extract(kind: Kind, bytes: Uint8Array): Promise<string> {
  switch (kind) {
    case 'markdown':
    case 'text':
      return decode(bytes);
    case 'html':
      return htmlToText(decode(bytes));
    case 'pdf': {
      const { extractText } = await load('unpdf', () => import('unpdf'));
      // unpdf may transfer the buffer to a worker, so give it a copy.
      const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
      return text;
    }
    case 'docx': {
      const mammoth = await load('mammoth', () => import('mammoth'));
      const { value } = await (mammoth.default ?? mammoth).extractRawText({
        buffer: Buffer.from(bytes),
      });
      return value;
    }
  }
}

/** UTF-8 text. TextDecoder drops a leading byte-order mark by itself. */
function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

async function load<T>(name: string, importer: () => Promise<T>): Promise<T> {
  try {
    return await importer();
  } catch (error) {
    throw new IngestError(
      'missing_parser',
      `Install ${name} to read these files: pnpm add ${name}`,
      {
        cause: error,
      },
    );
  }
}
