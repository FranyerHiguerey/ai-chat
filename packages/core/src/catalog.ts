import { z } from 'zod';

const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'Use an http or https URL');

/** One product or service. Only `id` and `name` are required. */
export const catalogItemSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  price: z.number().nonnegative().optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Use a 3-letter currency code, e.g. USD')
    .transform((value) => value.toUpperCase())
    .optional(),
  unit: z.string().trim().max(40).optional(),
  url: httpUrl.optional(),
  image: httpUrl.optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  /** Anything else worth matching on, e.g. `{ capacidad: "250 ml", material: "PEAD" }`. */
  attributes: z.record(z.string().max(200)).default({}),
});

export type CatalogItemInput = z.input<typeof catalogItemSchema>;
export type CatalogItem = z.output<typeof catalogItemSchema>;

/** A catalog with unique ids, capped at `maxItems`. */
export function catalogSchema(maxItems: number) {
  return z
    .array(catalogItemSchema)
    .max(maxItems, `The catalog has more than ${maxItems} items (limits.maxCatalogItems)`)
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item.id)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'id'],
            message: `Duplicate id "${item.id}"`,
          });
        }
        seen.add(item.id);
      });
    });
}

/** Lowercase, no accents, words of letters or digits. */
function words(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * A word and its singular guesses: frascos → frasco, bidones → bidon,
 * bottles → bottle. Matching any of them avoids a real stemmer while getting
 * Spanish and English plurals right.
 */
function variants(word: string): string[] {
  if (/^\d/.test(word) || word.length <= 3) return [word];
  const forms = [word];
  if (word.endsWith('s')) forms.push(word.slice(0, -1));
  if (word.endsWith('es')) forms.push(word.slice(0, -2));
  return forms;
}

const STOP_WORDS = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'un',
  'una',
  'y',
  'o',
  'en',
  'para',
  'con',
  'por',
  'que',
  'the',
  'a',
  'an',
  'of',
  'and',
  'or',
  'for',
  'with',
  'in',
  'to',
]);

/** A result needs at least this share of the best result's score. */
const RELEVANCE = 0.75;

const wordSet = (text: string) => new Set(words(text).flatMap(variants));

/**
 * Finds catalog items for a visitor's query, best first. Deterministic keyword
 * scoring, no embeddings: a match in the name counts 3, in a tag 2, in an
 * attribute or the description 1, and numbers count double. An exact id puts the item first. Items with
 * no matching word are never returned, and ties keep catalog order.
 */
export function searchCatalog(items: CatalogItem[], query: string, limit = 4): CatalogItem[] {
  const queryTerms = words(query).filter((word) => !STOP_WORDS.has(word));
  const exactId = query.trim().toLowerCase();
  if (queryTerms.length === 0 && !exactId) return [];

  const scored = items.map((item, index) => {
    if (item.id.toLowerCase() === exactId) return { item, index, score: Number.POSITIVE_INFINITY };
    const name = wordSet(item.name);
    const tags = wordSet(item.tags.join(' '));
    const rest = wordSet(
      [item.description ?? '', ...Object.entries(item.attributes).flat()].join(' '),
    );
    let score = 0;
    for (const term of queryTerms) {
      const forms = variants(term);
      // A size or model number is what tells "250 ml" from "120 ml": it counts double.
      const weight = /^\d/.test(term) ? 2 : 1;
      if (forms.some((form) => name.has(form))) score += 3 * weight;
      else if (forms.some((form) => tags.has(form))) score += 2 * weight;
      else if (forms.some((form) => rest.has(form))) score += weight;
    }
    return { item, index, score };
  });

  const best = Math.max(0, ...scored.map((entry) => entry.score));
  // Only close matches: for "frascos de 250 ml" the 250 ml jar, not every jar or every 250 ml item.
  const minScore = Math.max(1, best * RELEVANCE);
  return scored
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}

/** What the model reads back from search_catalog: compact, one item per line. */
export function catalogResultText(items: CatalogItem[]): string {
  if (items.length === 0) {
    return 'No matching products. Say so honestly and offer to put the visitor in touch with the team.';
  }
  const lines = items.map((item) => {
    const parts = [`id: ${item.id}`, `name: ${item.name}`];
    if (item.description) parts.push(`description: ${item.description}`);
    for (const [key, value] of Object.entries(item.attributes)) parts.push(`${key}: ${value}`);
    if (item.price !== undefined) {
      parts.push(
        `price: ${item.price}${item.currency ? ` ${item.currency}` : ''}${item.unit ? ` per ${item.unit}` : ''}`,
      );
    }
    if (item.tags.length) parts.push(`tags: ${item.tags.join(', ')}`);
    return `- ${parts.join(' | ')}`;
  });
  return `Shown to the visitor as cards:\n${lines.join('\n')}\nNow write your short answer from these results.`;
}
