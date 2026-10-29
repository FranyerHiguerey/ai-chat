import { z } from 'zod';
import { catalogResultText, searchCatalog, type CatalogItem } from './catalog.js';
import type { ChatConfig } from './config.js';
import { customToolSpec } from './custom-tool.js';
import type { CardItem, HandoffChannel, ServerEvent } from './protocol.js';
import type { ToolCall, ToolSpec } from './types.js';

/**
 * UI tools: the model calls them after writing its answer, and the server turns
 * each call into a stream event. They never need a second model call, and the
 * model never writes links or contact details: those come from the config.
 */

const MAX_SUGGESTIONS = 3;
const MAX_SUGGESTION_CHARS = 60;
const MAX_SUMMARY_CHARS = 300;
const MAX_REASON_CHARS = 200;

/** Strict-mode JSON Schema for an object whose properties are all required. */
function objectSchema(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const SUGGEST_REPLIES: ToolSpec = {
  name: 'suggest_replies',
  description:
    'Offer the visitor up to 3 short follow-up questions they are likely to ask next, written as the visitor would type them, in their language. Use after answering, only when there is a natural next question.',
  parameters: objectSchema({
    replies: {
      type: 'array',
      items: { type: 'string' },
      description: '1 to 3 questions, each under 60 characters.',
    },
  }),
};

const OFFER_HANDOFF: ToolSpec = {
  name: 'offer_handoff',
  description:
    "Show buttons that put the visitor in touch with the team (WhatsApp or email). Use when the visitor asks for a person, or when the knowledge doesn't answer their question.",
  parameters: objectSchema({
    summary: {
      type: 'string',
      description:
        "A one-sentence summary of what the visitor needs, in their language, written as the visitor's first message to the team.",
    },
  }),
};

const SHOW_LEAD_FORM: ToolSpec = {
  name: 'show_lead_form',
  description:
    'Show a short contact form (name, email or phone, message) so the team can follow up. Use when the visitor wants a quote, a call back, or to be contacted.',
  parameters: objectSchema({
    reason: {
      type: 'string',
      description: "One short sentence, in the visitor's language, saying why the form is shown.",
    },
  }),
};

const SEARCH_CATALOG: ToolSpec = {
  name: 'search_catalog',
  description:
    "Search the company's product catalog. The matches are shown to the visitor as product cards and returned to you. Use it before answering any question about products, sizes, materials, availability or prices.",
  parameters: objectSchema({
    query: {
      type: 'string',
      description:
        'A few keywords in the catalog\'s terms, e.g. "frasco 250 ml" or "PET bottle 1 L".',
    },
  }),
};

/**
 * The tools this site offers, in a fixed order so the cached prompt prefix
 * stays identical. Pass the catalog size: search is offered only with products.
 */
export function toolsFor(config: ChatConfig, catalogSize = 0): ToolSpec[] {
  const tools: ToolSpec[] = [];
  if (catalogSize > 0) tools.push(SEARCH_CATALOG);
  if (config.features.suggestions) tools.push(SUGGEST_REPLIES);
  if (handoffChannels(config, '').length > 0) tools.push(OFFER_HANDOFF);
  if (config.features.leadCapture) tools.push(SHOW_LEAD_FORM);
  // The site's own tools go last, so the built-ins' cached prefix doesn't move.
  for (const tool of config.tools) tools.push(customToolSpec(tool));
  return tools;
}

/** Prompt rules for the offered tools. Empty when there are none. */
export function toolInstructions(tools: ToolSpec[], config?: ChatConfig): string[] {
  if (tools.length === 0) return [];
  const offered = new Set(tools.map((tool) => tool.name));
  // Phrased the way models are trained to use functions: call, get the result,
  // then answer. Asking for text and calls in one go made OpenAI models skip
  // the call; the client runs the second round (see MAX_ROUNDS in client.ts).
  const lines = ['', 'Tools: they show buttons and forms to the visitor and return right away.'];
  if (offered.has('search_catalog')) {
    lines.push(
      "- When the visitor asks about products, sizes, materials, availability or prices: call search_catalog first with a short query in the catalog's terms; once it returns, answer from the results. They are already shown as cards, so don't repeat every detail. Never mention products the search did not return.",
    );
  }
  if (offered.has('show_lead_form')) {
    lines.push(
      '- When the visitor wants a quote, a price for a specific order, a call back or to be contacted: call show_lead_form first; once it returns, write a short answer that points to the form. Do not ask for their name, email or phone in the chat; the form collects them.',
    );
  }
  if (offered.has('offer_handoff')) {
    lines.push(
      '- When the visitor asks to talk to a person, or the documents do not answer their question: call offer_handoff first; once it returns, write a short answer. The buttons carry the contact details, so do not repeat phone numbers or emails.',
    );
  }
  if (offered.has('suggest_replies')) {
    lines.push(
      '- When there is a natural next question, call suggest_replies in the same reply as your answer (not before it), with up to 3 short questions.',
    );
  }
  for (const tool of config?.tools ?? []) {
    if (tool.instructions) lines.push(`- ${tool.name}: ${tool.instructions}`);
  }
  lines.push('- Call each tool at most once per reply.');
  lines.push(
    '- Never tell the visitor to fill in a form or press a button unless you called the tool that shows it.',
  );
  return lines;
}

/** The events UI tools produce. */
export type ToolEvent = Extract<ServerEvent, { type: 'suggestions' | 'card' }>;

/** What a tool needs beyond its input. */
export interface ToolContext {
  config: ChatConfig;
  catalog: CatalogItem[];
}

/** What a call shows the visitor (if anything) and what the model reads back. */
export interface ToolOutcome {
  event?: ToolEvent;
  output: string;
}

export const TOOL_SHOWN = 'Shown to the visitor. Now write your short answer.';
export const TOOL_NOT_SHOWN =
  'Not shown (already shown or invalid input). Write your short answer.';

const MAX_QUERY_CHARS = 200;
const searchInput = z.object({ query: z.string() });

/** The public part of a catalog item: what a card shows. */
const toCardItem = ({ id, name, description, url, image }: CatalogItem): CardItem => ({
  id,
  name,
  ...(description && { description }),
  ...(url && { url }),
  ...(image && { image }),
});

/**
 * Runs a tool call. Catalog search shows its matches as cards and hands the
 * same items to the model; the UI tools only report whether they were shown.
 */
export function runTool(call: ToolCall, ctx: ToolContext): ToolOutcome {
  if (call.name === 'search_catalog') {
    const input = searchInput.safeParse(call.input);
    if (!input.success || ctx.catalog.length === 0) return { output: TOOL_NOT_SHOWN };
    const query = clip(input.data.query, MAX_QUERY_CHARS);
    const found = searchCatalog(ctx.catalog, query);
    if (found.length > 0) {
      return {
        event: { type: 'card', kind: 'items', items: found.map(toCardItem) },
        output: catalogResultText(found),
      };
    }
    // Nothing matched: offer the team right away. The answering round can't call
    // tools any more, so without this the model types the contact details instead.
    const channels = handoffChannels(ctx.config, query);
    if (channels.length === 0) return { output: catalogResultText([]) };
    return {
      event: { type: 'card', kind: 'handoff', channels },
      output:
        'No matching products. Buttons to contact the team are shown to the visitor; say so briefly instead of listing contact details.',
    };
  }
  const event = toolEvent(call, ctx.config);
  return event ? { event, output: TOOL_SHOWN } : { output: TOOL_NOT_SHOWN };
}

const clip = (text: string, max: number) => {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
};

const suggestInput = z.object({ replies: z.array(z.string()) });
const summaryInput = z.object({ summary: z.string() });
const reasonInput = z.object({ reason: z.string() });

/** WhatsApp and email links from the config, with `summary` as the prefilled message. */
export function handoffChannels(config: ChatConfig, summary: string): HandoffChannel[] {
  const handoff = config.features.handoff;
  const whatsapp = handoff?.whatsapp;
  const email = handoff?.email;
  const channels: HandoffChannel[] = [];
  if (whatsapp) {
    const text = summary ? `?text=${encodeURIComponent(summary)}` : '';
    channels.push({ type: 'whatsapp', href: `https://wa.me/${whatsapp}${text}` });
  }
  if (email) {
    const query = new URLSearchParams({ subject: config.company.name });
    if (summary) query.set('body', summary);
    // URLSearchParams encodes spaces as "+", which mail clients show literally.
    channels.push({
      type: 'email',
      href: `mailto:${email}?${query.toString().replace(/\+/g, '%20')}`,
    });
  }
  return channels;
}

/**
 * Turns a tool call into the event the widget shows, or `undefined` when the
 * input is unusable or the tool isn't offered. The model's text is clipped,
 * never trusted for links.
 */
export function toolEvent(call: ToolCall, config: ChatConfig): ToolEvent | undefined {
  switch (call.name) {
    case 'suggest_replies': {
      if (!config.features.suggestions) return undefined;
      const input = suggestInput.safeParse(call.input);
      if (!input.success) return undefined;
      const items = input.data.replies
        .map((reply) => clip(reply, MAX_SUGGESTION_CHARS))
        .filter(Boolean)
        .slice(0, MAX_SUGGESTIONS);
      return items.length ? { type: 'suggestions', items } : undefined;
    }
    case 'offer_handoff': {
      const input = summaryInput.safeParse(call.input);
      if (!input.success) return undefined;
      const channels = handoffChannels(config, clip(input.data.summary, MAX_SUMMARY_CHARS));
      return channels.length ? { type: 'card', kind: 'handoff', channels } : undefined;
    }
    case 'show_lead_form': {
      if (!config.features.leadCapture) return undefined;
      const input = reasonInput.safeParse(call.input);
      if (!input.success) return undefined;
      return { type: 'card', kind: 'lead_form', reason: clip(input.data.reason, MAX_REASON_CHARS) };
    }
    default:
      return undefined;
  }
}
