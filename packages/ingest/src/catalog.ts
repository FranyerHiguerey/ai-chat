/**
 * Catalog import: a CSV or JSON file from the site owner becomes catalog items
 * in the shape ai-chat-core expects. Bad rows are reported, the rest import.
 */

/** The same shape as ai-chat-core's `CatalogItemInput`; core validates it again on load. */
export interface CatalogItem {
  id: string;
  name: string;
  description?: string;
  price?: number;
  currency?: string;
  unit?: string;
  url?: string;
  image?: string;
  tags: string[];
  attributes: Record<string, string>;
}

export interface CatalogRowError {
  /** 1-based, counting the header as row 1 in CSV, or the array index + 1 in JSON. */
  row: number;
  message: string;
}

export interface ParsedCatalog {
  items: CatalogItem[];
  errors: CatalogRowError[];
}

type Field = Exclude<keyof CatalogItem, 'attributes'>;

/** Column names site owners write, in Spanish and English, accents and case ignored. */
const ALIASES: Record<string, Field> = {
  id: 'id',
  sku: 'id',
  codigo: 'id',
  code: 'id',
  ref: 'id',
  referencia: 'id',
  name: 'name',
  nombre: 'name',
  producto: 'name',
  product: 'name',
  title: 'name',
  titulo: 'name',
  description: 'description',
  descripcion: 'description',
  price: 'price',
  precio: 'price',
  currency: 'currency',
  moneda: 'currency',
  unit: 'unit',
  unidad: 'unit',
  url: 'url',
  link: 'url',
  enlace: 'url',
  pagina: 'url',
  image: 'image',
  imagen: 'image',
  foto: 'image',
  photo: 'image',
  tags: 'tags',
  etiquetas: 'tags',
  categoria: 'tags',
  category: 'tags',
};

const normalizeKey = (key: string) =>
  key.normalize('NFKD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

const slug = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/**
 * Parses CSV per RFC 4180: quoted fields, doubled quotes, commas and newlines
 * inside quotes, CRLF. The separator (`,` or `;`, which Spanish Excel uses) is
 * whichever appears more in the header line.
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const firstLine = input.slice(
    0,
    input.search(/\r?\n/) === -1 ? undefined : input.search(/\r?\n/),
  );
  const separator =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === separator) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const isBlank = (cells: string[]) => cells.every((cell) => cell.trim() === '');

/** An absolute http(s) URL, or a root-relative path on the site (`/images/x.webp`). */
const isLink = (value: string) => {
  if (/^\/(?![/\\])/.test(value)) return !/\s/.test(value);
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/** A price as owners write it: "0,25", "1.234,50", "$ 12.5", "12.50 USD". */
function parsePrice(value: string): number | undefined {
  let text = value.replace(/[^\d.,-]/g, '');
  if (!text) return undefined;
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  // The rightmost separator is the decimal one; the other groups thousands.
  if (comma > dot) text = text.replace(/\./g, '').replace(',', '.');
  else text = text.replace(/,/g, '');
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

/** One record (CSV row or JSON object) into an item, or the reason it can't be one. */
function toItem(record: Record<string, unknown>): CatalogItem | string {
  const item: CatalogItem = { id: '', name: '', tags: [], attributes: {} };
  for (const [rawKey, rawValue] of Object.entries(record)) {
    if (rawValue === null || rawValue === undefined) continue;
    const field = ALIASES[normalizeKey(rawKey)];
    if (field === 'tags') {
      const values = Array.isArray(rawValue)
        ? rawValue.map(String)
        : String(rawValue).split(/[|;]/);
      item.tags = values.map((tag) => tag.trim()).filter(Boolean);
      continue;
    }
    if (rawKey === 'attributes' && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      for (const [key, value] of Object.entries(rawValue)) {
        if (String(value).trim()) item.attributes[key] = String(value).trim();
      }
      continue;
    }
    const value = typeof rawValue === 'number' ? String(rawValue) : String(rawValue).trim();
    if (!value) continue;
    if (!field) {
      item.attributes[rawKey.trim()] = value;
    } else if (field === 'price') {
      const price = typeof rawValue === 'number' ? rawValue : parsePrice(value);
      if (price === undefined) return `price "${value}" is not a number`;
      item.price = price;
    } else if ((field === 'url' || field === 'image') && !isLink(value)) {
      return `${field} "${value}" is not an http(s) link or a path starting with /`;
    } else {
      item[field] = value;
    }
  }
  if (!item.name) return 'name is missing';
  item.id ||= slug(item.name);
  if (!item.id) return 'id is missing and the name has no letters or digits';
  if (item.currency && !/^[A-Za-z]{3}$/.test(item.currency)) {
    return `currency "${item.currency}" should be a 3-letter code like USD`;
  }
  return item;
}

/**
 * Reads a catalog file. `format` defaults to JSON when the text starts with
 * `[`, CSV otherwise. Rows with errors are skipped and listed, so the owner can
 * fix them; a duplicated id keeps its first row.
 */
export function parseCatalog(
  text: string,
  options: { format?: 'csv' | 'json' } = {},
): ParsedCatalog {
  const format = options.format ?? (text.trimStart().startsWith('[') ? 'json' : 'csv');
  const records: { row: number; record: Record<string, unknown> }[] = [];
  const errors: CatalogRowError[] = [];

  if (format === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { items: [], errors: [{ row: 0, message: 'The file is not valid JSON' }] };
    }
    if (!Array.isArray(parsed)) {
      return { items: [], errors: [{ row: 0, message: 'The JSON must be an array of products' }] };
    }
    parsed.forEach((record, index) => {
      if (record && typeof record === 'object' && !Array.isArray(record)) {
        records.push({ row: index + 1, record: record as Record<string, unknown> });
      } else {
        errors.push({ row: index + 1, message: 'not an object' });
      }
    });
  } else {
    const [header, ...rows] = parseCsv(text);
    if (!header || isBlank(header)) {
      return { items: [], errors: [{ row: 0, message: 'The file is empty' }] };
    }
    rows.forEach((cells, index) => {
      // Blank rows are skipped but still counted, so row numbers match the spreadsheet.
      if (isBlank(cells)) return;
      const record: Record<string, string> = {};
      header.forEach((column, i) => {
        if (column.trim()) record[column.trim()] = cells[i] ?? '';
      });
      records.push({ row: index + 2, record });
    });
  }

  const items: CatalogItem[] = [];
  const seen = new Set<string>();
  for (const { row, record } of records) {
    const result = toItem(record);
    if (typeof result === 'string') {
      errors.push({ row, message: result });
    } else if (seen.has(result.id)) {
      errors.push({ row, message: `duplicate id "${result.id}", kept the first one` });
    } else {
      seen.add(result.id);
      items.push(result);
    }
  }
  return { items, errors };
}
