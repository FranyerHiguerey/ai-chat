import { describe, expect, it } from 'vitest';
import { testConfig } from '../test/helpers.js';
import type { CatalogItem } from './catalog.js';
import {
  handoffChannels,
  runTool,
  TOOL_NOT_SHOWN,
  TOOL_SHOWN,
  toolEvent,
  toolInstructions,
  toolsFor,
} from './tools.js';

const call = (name: string, input: unknown) => ({ id: 'c1', name, input });
const full = testConfig({
  features: {
    handoff: { whatsapp: '+584121234567', email: 'ventas@acme.test' },
    leadCapture: { webhookUrl: 'https://hooks.acme.test/lead' },
  },
});

describe('toolsFor', () => {
  it('offers only what the site configured, in a fixed order', () => {
    expect(toolsFor(testConfig()).map((t) => t.name)).toEqual(['suggest_replies']);
    expect(toolsFor(full).map((t) => t.name)).toEqual([
      'suggest_replies',
      'offer_handoff',
      'show_lead_form',
    ]);
    expect(toolsFor(testConfig({ features: { suggestions: false } }))).toEqual([]);
  });

  it('uses strict-mode schemas: every property required, no extra keys', () => {
    for (const tool of toolsFor(full)) {
      const schema = tool.parameters as {
        properties: object;
        required: string[];
        additionalProperties: boolean;
      };
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(Object.keys(schema.properties));
    }
  });

  it('asks for the form and handoff before the answer, chips with it', () => {
    const rules = toolInstructions(toolsFor(full)).join('\n');
    expect(rules).toMatch(/call show_lead_form first; once it returns, write/);
    expect(rules).toMatch(/call offer_handoff first; once it returns, write/);
    expect(rules).toMatch(/suggest_replies in the same reply as your answer/);
    expect(rules).toMatch(/Never tell the visitor to fill in a form/);
    // "Answer first, call tools after" made OpenAI models skip the calls entirely.
    expect(rules).not.toMatch(/write your answer first|only after/i);
  });

  it('adds prompt rules only for offered tools', () => {
    expect(toolInstructions([])).toEqual([]);
    const rules = toolInstructions(toolsFor(testConfig())).join('\n');
    expect(rules).toContain('suggest_replies');
    expect(rules).not.toContain('show_lead_form');
  });
});

describe('toolEvent', () => {
  it('turns suggestions into clipped chips, at most 3', () => {
    const long = 'x'.repeat(80);
    const event = toolEvent(
      call('suggest_replies', { replies: ['¿Precios?', ' ', long, 'a', 'b'] }),
      full,
    );
    expect(event).toEqual({ type: 'suggestions', items: ['¿Precios?', `${'x'.repeat(59)}…`, 'a'] });
  });

  it('builds handoff links from the config, never from the model', () => {
    const event = toolEvent(
      call('offer_handoff', { summary: 'Quiero 5.000 frascos & tapas' }),
      full,
    );
    expect(event).toEqual({
      type: 'card',
      kind: 'handoff',
      channels: [
        {
          type: 'whatsapp',
          href: 'https://wa.me/584121234567?text=Quiero%205.000%20frascos%20%26%20tapas',
        },
        {
          type: 'email',
          href: 'mailto:ventas@acme.test?subject=Acme%20Plastics&body=Quiero%205.000%20frascos%20%26%20tapas',
        },
      ],
    });
  });

  it('shows the lead form only when lead capture is configured', () => {
    expect(toolEvent(call('show_lead_form', { reason: 'Para cotizar' }), full)).toEqual({
      type: 'card',
      kind: 'lead_form',
      reason: 'Para cotizar',
    });
    expect(toolEvent(call('show_lead_form', { reason: 'x' }), testConfig())).toBeUndefined();
  });

  it('drops bad input, unknown tools and handoffs with no channel', () => {
    expect(toolEvent(call('suggest_replies', { replies: 'nope' }), full)).toBeUndefined();
    expect(toolEvent(call('suggest_replies', { replies: [] }), full)).toBeUndefined();
    expect(toolEvent(call('delete_everything', {}), full)).toBeUndefined();
    expect(toolEvent(call('offer_handoff', { summary: 'x' }), testConfig())).toBeUndefined();
    expect(handoffChannels(testConfig(), '')).toEqual([]);
  });
});

describe('runTool', () => {
  const catalog: CatalogItem[] = [
    {
      id: 'f250',
      name: 'Frasco PEAD 250 ml',
      description: 'Boca ancha',
      url: 'https://acme.test/f250',
      image: 'https://acme.test/f250.jpg',
      price: 0.3,
      currency: 'USD',
      tags: [],
      attributes: { capacidad: '250 ml' },
    },
    { id: 'b500', name: 'Botella PET 500 ml', tags: [], attributes: {} },
  ];

  it('offers search only with a catalog, and first', () => {
    expect(toolsFor(full, 2).map((t) => t.name)[0]).toBe('search_catalog');
    expect(toolsFor(full, 0).map((t) => t.name)).not.toContain('search_catalog');
    expect(toolInstructions(toolsFor(full, 2)).join('\n')).toMatch(/call search_catalog first/);
  });

  it('shows matches as cards without prices and gives the model the details', () => {
    const outcome = runTool(call('search_catalog', { query: 'frascos 250' }), {
      config: full,
      catalog,
    });
    expect(outcome.event).toEqual({
      type: 'card',
      kind: 'items',
      items: [
        {
          id: 'f250',
          name: 'Frasco PEAD 250 ml',
          description: 'Boca ancha',
          url: 'https://acme.test/f250',
          image: 'https://acme.test/f250.jpg',
        },
      ],
    });
    expect(outcome.output).toContain('price: 0.3 USD');
  });

  it('offers the team when nothing matches, or says so when there is no handoff', () => {
    const search = call('search_catalog', { query: 'helicóptero' });
    const outcome = runTool(search, { config: full, catalog });
    expect(outcome.event).toMatchObject({ type: 'card', kind: 'handoff' });
    expect(outcome.output).toMatch(/^No matching products\. Buttons/);

    const bare = runTool(search, { config: testConfig(), catalog });
    expect(bare.event).toBeUndefined();
    expect(bare.output).toMatch(/^No matching products\. Say so honestly/);
  });

  it('reports UI tools as shown or not', () => {
    expect(
      runTool(call('show_lead_form', { reason: 'x' }), { config: full, catalog: [] }).output,
    ).toBe(TOOL_SHOWN);
    expect(
      runTool(call('search_catalog', { query: 'x' }), { config: full, catalog: [] }).output,
    ).toBe(TOOL_NOT_SHOWN);
  });
});
