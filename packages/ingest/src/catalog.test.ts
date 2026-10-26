import { describe, expect, it } from 'vitest';
import { parseCatalog, parseCsv } from './catalog.js';

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, separators and newlines inside quotes, CRLF and a BOM', () => {
    const csv =
      '\uFEFFnombre,descripción\r\n"Frasco, 250 ml","Boca ""ancha""\nreforzada"\r\nTapa,\r\n';
    expect(parseCsv(csv)).toEqual([
      ['nombre', 'descripción'],
      ['Frasco, 250 ml', 'Boca "ancha"\nreforzada'],
      ['Tapa', ''],
    ]);
  });

  it('uses ; when the header does (Spanish Excel)', () => {
    expect(parseCsv('nombre;precio\nFrasco;0,25')).toEqual([
      ['nombre', 'precio'],
      ['Frasco', '0,25'],
    ]);
  });
});

describe('parseCatalog', () => {
  it('maps Spanish and English headers, extra columns to attributes, and tags', () => {
    const csv = [
      'SKU;Nombre;Precio;Moneda;Capacidad;Categoría;Enlace',
      'F250;Frasco PEAD 250 ml;0,25;usd;250 ml;frascos|alimentos;https://acme.test/f250',
    ].join('\n');
    expect(parseCatalog(csv)).toEqual({
      items: [
        {
          id: 'F250',
          name: 'Frasco PEAD 250 ml',
          price: 0.25,
          currency: 'usd',
          tags: ['frascos', 'alimentos'],
          url: 'https://acme.test/f250',
          attributes: { Capacidad: '250 ml' },
        },
      ],
      errors: [],
    });
  });

  it('reports bad rows with their row number and imports the rest', () => {
    const csv = [
      'name,price,url',
      'Jar 250 ml,1.5,',
      ',2,',
      'Bottle,abc,',
      'Cap,0.05,javascript:alert(1)',
      'Bucket 20 L,"1.234,50",https://acme.test/b',
    ].join('\n');
    const { items, errors } = parseCatalog(csv);
    expect(items.map((item) => [item.id, item.price])).toEqual([
      ['jar-250-ml', 1.5],
      ['bucket-20-l', 1234.5],
    ]);
    expect(errors).toEqual([
      { row: 3, message: 'name is missing' },
      { row: 4, message: 'price "abc" is not a number' },
      { row: 5, message: 'url "javascript:alert(1)" is not an http(s) link' },
    ]);
  });

  it('numbers rows like the spreadsheet, counting blank rows', () => {
    const csv = 'name,url\nJar,\n,\n\nCap,not-a-link';
    expect(parseCatalog(csv).errors).toEqual([
      { row: 5, message: 'url "not-a-link" is not an http(s) link' },
    ]);
  });

  it('keeps the first of duplicated ids', () => {
    const { items, errors } = parseCatalog('id,name\na,First\na,Second');
    expect(items.map((item) => item.name)).toEqual(['First']);
    expect(errors[0]).toMatchObject({ row: 3, message: expect.stringMatching(/duplicate id "a"/) });
  });

  it('reads a JSON array with the same field names', () => {
    const json = JSON.stringify([
      {
        id: 'b1',
        nombre: 'Botella 1 L',
        precio: 0.4,
        tags: ['bebidas'],
        attributes: { material: 'PET' },
      },
      'nope',
    ]);
    expect(parseCatalog(json)).toEqual({
      items: [
        {
          id: 'b1',
          name: 'Botella 1 L',
          price: 0.4,
          tags: ['bebidas'],
          attributes: { material: 'PET' },
        },
      ],
      errors: [{ row: 2, message: 'not an object' }],
    });
    expect(parseCatalog('{"a":1}', { format: 'json' }).errors[0]?.message).toMatch(/array/);
  });
});
