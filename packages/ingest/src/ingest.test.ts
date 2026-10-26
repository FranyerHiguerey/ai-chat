import { describe, expect, it, vi } from 'vitest';
import { makePdf } from '../test/pdf.js';
import { IngestError } from './errors.js';
import { safeFileName, toKnowledgeDoc } from './ingest.js';

vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(async () => ({ value: 'Precios\r\n\r\n\r\nSe cotizan.', messages: [] })),
  },
}));

const bytes = (text: string) => new TextEncoder().encode(text);
const file = (name: string, content: string | Uint8Array, type?: string) => ({
  name,
  type,
  bytes: typeof content === 'string' ? bytes(content) : content,
});

async function ingestError(promise: Promise<unknown>): Promise<IngestError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(IngestError);
  return error as IngestError;
}

describe('toKnowledgeDoc', () => {
  it('keeps markdown and text, normalizing line endings and a BOM', async () => {
    expect(await toKnowledgeDoc(file('Preguntas Frecuentes.md', '\uFEFF# FAQ\r\nSí.\r\n'))).toEqual(
      {
        file: 'preguntas-frecuentes.md',
        content: '# FAQ\nSí.',
      },
    );
    expect((await toKnowledgeDoc(file('notas.txt', 'Hola'))).content).toBe('Hola');
  });

  it('turns HTML into text without scripts or styles', async () => {
    const html =
      '<html><head><style>p{}</style><script>alert(1)</script></head><body><h1>Envíos</h1><p>Gratis &amp; rápido</p><!-- x --></body></html>';
    expect((await toKnowledgeDoc(file('envios.html', html))).content).toBe(
      'Envíos\n\nGratis & rápido',
    );
  });

  it('extracts the text of a real PDF', async () => {
    const doc = await toKnowledgeDoc(
      file('Catalogo 2026.pdf', makePdf('Frascos desde 3000 unidades')),
    );
    expect(doc).toEqual({ file: 'catalogo-2026.md', content: 'Frascos desde 3000 unidades' });
  });

  it('extracts DOCX text through mammoth', async () => {
    const doc = await toKnowledgeDoc(file('precios.docx', new Uint8Array([80, 75, 3, 4])));
    expect(doc).toEqual({ file: 'precios.md', content: 'Precios\n\nSe cotizan.' });
  });

  it('falls back to the MIME type when the name has no known extension', async () => {
    expect(
      (await toKnowledgeDoc(file('upload', 'Hola', 'text/plain; charset=utf-8'))).content,
    ).toBe('Hola');
  });

  it('rejects unsupported, oversized and empty files with typed codes', async () => {
    expect((await ingestError(toKnowledgeDoc(file('foto.png', 'x', 'image/png')))).code).toBe(
      'unsupported_type',
    );
    expect((await ingestError(toKnowledgeDoc(file('a.md', 'xxxx'), { maxBytes: 3 }))).code).toBe(
      'too_large',
    );
    expect((await ingestError(toKnowledgeDoc(file('vacio.md', ' \n\n ')))).code).toBe('empty');
  });
});

describe('safeFileName', () => {
  it('produces names that cannot escape a folder', () => {
    expect(safeFileName('../../etc/passwd')).toBe('etc-passwd.md');
    expect(safeFileName('..\\..\\Windows\\win.ini')).toBe('windows-win.md');
    expect(safeFileName('Política de Envíos.final.PDF')).toBe('politica-de-envios-final.md');
    expect(safeFileName('...')).toBe('document.md');
  });
});
