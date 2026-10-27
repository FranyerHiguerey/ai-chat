import { describe, expect, it } from 'vitest';
import {
  catalogItemSchema,
  catalogResultText,
  catalogSchema,
  searchCatalog,
  type CatalogItem,
} from './catalog.js';

const item = (input: Parameters<typeof catalogItemSchema.parse>[0]) =>
  catalogItemSchema.parse(input);
const CATALOG: CatalogItem[] = [
  item({
    id: 'frasco-120',
    name: 'Frasco PEAD 120 ml',
    attributes: { capacidad: '120 ml' },
    tags: ['frascos'],
  }),
  item({
    id: 'frasco-250',
    name: 'Frasco PEAD 250 ml',
    attributes: { capacidad: '250 ml', boca: 'ancha' },
    tags: ['frascos'],
  }),
  item({
    id: 'botella-500',
    name: 'Botella PET 500 ml',
    description: 'Para bebidas y jugos',
    attributes: { capacidad: '500 ml' },
  }),
  item({ id: 'bidon-20', name: 'Bidón PEAD 20 L', tags: ['limpieza'] }),
  item({ id: 'bottle-1l', name: 'PET bottle 1 L', tags: ['beverages'] }),
];
const ids = (query: string) => searchCatalog(CATALOG, query).map((i) => i.id);

describe('searchCatalog', () => {
  it('ranks name matches first and uses numbers to pick the size', () => {
    expect(ids('¿Tienen frascos de 250 ml?')[0]).toBe('frasco-250');
    expect(ids('frascos')).toEqual(['frasco-120', 'frasco-250']);
  });

  it('ignores accents and folds Spanish and English plurals', () => {
    expect(ids('bidones')).toEqual(['bidon-20']);
    expect(ids('BIDON')).toEqual(['bidon-20']);
    expect(ids('bottles')).toEqual(['bottle-1l']);
  });

  it('matches descriptions and tags with lower weight', () => {
    expect(ids('jugos')).toEqual(['botella-500']);
    expect(ids('limpieza')).toEqual(['bidon-20']);
  });

  it('puts an exact id first and returns nothing for no match or stop words only', () => {
    expect(ids('botella-500')[0]).toBe('botella-500');
    expect(ids('helicóptero')).toEqual([]);
    expect(ids('de la para')).toEqual([]);
  });

  it('shows only close matches, not every item sharing one word', () => {
    // pead-250 matches frasco + 250 + ml; the 120 ml jar and the 500 ml bottle match only part.
    expect(ids('frascos de 250 ml')).toEqual(['frasco-250']);
    // The query the model actually sent live: the size has to win over the shared words.
    expect(ids('frasco PEAD 250 ml')).toEqual(['frasco-250']);
  });

  it('returns at most the limit', () => {
    expect(searchCatalog(CATALOG, 'pead ml', 2)).toHaveLength(2);
  });
});

describe('catalog schema', () => {
  it('applies defaults and normalizes the currency', () => {
    const parsed = item({ id: 'a', name: 'A', price: 0.12, currency: 'usd' });
    expect(parsed).toMatchObject({ currency: 'USD', tags: [], attributes: {} });
  });

  it('accepts root-relative paths for images and links, but nothing that leaves the site', () => {
    const ok = catalogItemSchema.safeParse({
      id: 'a',
      name: 'A',
      image: '/images/chat/a.webp',
      url: '/#productos',
    });
    expect(ok.success).toBe(true);
    for (const bad of [
      '//evil.test/a.png',
      '/\\evil.test/a.png',
      'images/a.png',
      '/a b.png',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
    ]) {
      expect(catalogItemSchema.safeParse({ id: 'a', name: 'A', image: bad }).success, bad).toBe(
        false,
      );
    }
  });

  it('rejects unsafe links, duplicate ids and catalogs over the cap', () => {
    expect(
      catalogItemSchema.safeParse({ id: 'a', name: 'A', url: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(
      catalogItemSchema.safeParse({ id: 'a', name: 'A', image: 'ftp://x.test/a.png' }).success,
    ).toBe(false);
    const dup = catalogSchema(10).safeParse([
      { id: 'a', name: 'A' },
      { id: 'a', name: 'B' },
    ]);
    expect(dup.success).toBe(false);
    expect(
      catalogSchema(1).safeParse([
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ]).success,
    ).toBe(false);
  });
});

describe('catalogResultText', () => {
  it('lists the shown items compactly, with price only when known', () => {
    const text = catalogResultText([
      item({
        id: 'f',
        name: 'Frasco',
        price: 0.25,
        currency: 'USD',
        unit: 'unidad',
        attributes: { capacidad: '250 ml' },
      }),
    ]);
    expect(text).toContain('id: f | name: Frasco | capacidad: 250 ml | price: 0.25 USD per unidad');
    expect(text).toMatch(/^Shown to the visitor/);
  });

  it('tells the model to be honest when nothing matched', () => {
    expect(catalogResultText([])).toMatch(/^No matching products/);
  });
});
