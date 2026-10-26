import { describe, expect, it } from 'vitest';
import { testConfig } from '../test/helpers.js';
import { handoffChannels, toolEvent, toolInstructions, toolsFor } from './tools.js';

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
