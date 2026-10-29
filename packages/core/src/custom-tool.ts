import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { CatalogItem } from './catalog.js';
import type { ToolCall, ToolSpec } from './types.js';

/**
 * Custom tools: a site's own functions the model can call, such as a price
 * calculator or a stock lookup. They run on the server; the result is text the
 * model reads before answering. Nothing is shown to the visitor directly.
 */

export interface CustomToolContext {
  /** The site's catalog, as the search tool sees it. */
  catalog: CatalogItem[];
  /** Aborted when the visitor leaves or the tool times out. */
  signal: AbortSignal;
}

export interface CustomTool<T extends z.AnyZodObject = z.AnyZodObject> {
  /** snake_case, unique, not one of the built-in tool names. */
  name: string;
  /** What it does and when to use it. The model reads this to decide. */
  description: string;
  /** Optional line added to the system prompt's tool rules, e.g. "Always use it for…". */
  instructions?: string;
  /** The arguments. Every field is required; use `.nullable()` for optional ones. */
  parameters: T;
  run(input: z.output<T>, ctx: CustomToolContext): string | Promise<string>;
}

/** Types a custom tool's `run` input from its `parameters`. */
export function defineTool<T extends z.AnyZodObject>(tool: CustomTool<T>): CustomTool<T> {
  return tool;
}

export const BUILT_IN_TOOLS = [
  'search_catalog',
  'suggest_replies',
  'offer_handoff',
  'show_lead_form',
] as const;

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

function isZodObject(value: unknown): value is z.AnyZodObject {
  const candidate = value as { _def?: { typeName?: unknown }; safeParse?: unknown } | null;
  return candidate?._def?.typeName === 'ZodObject' && typeof candidate.safeParse === 'function';
}

/** Config validation. `parameters` must be a Zod object; `run` a function. */
export const customToolSchema = z
  .object({
    name: z
      .string()
      .regex(TOOL_NAME, 'Use snake_case: lowercase letters, digits and _')
      .refine(
        (name) => !(BUILT_IN_TOOLS as readonly string[]).includes(name),
        'is a built-in tool name',
      ),
    description: z.string().trim().min(1).max(1000),
    instructions: z.string().trim().min(1).max(1000).optional(),
    // Structural, not instanceof: the site's zod may be a different copy than ours.
    parameters: z.custom<z.AnyZodObject>(isZodObject, {
      message: 'must be a Zod object (z.object({...}))',
    }),
    // `never` input: accepts a run typed for any parameters (see defineTool).
    run: z.custom<(input: never, ctx: CustomToolContext) => string | Promise<string>>(
      (value) => typeof value === 'function',
      {
        message: 'must be a function',
      },
    ),
  })
  .transform((tool) => tool as CustomTool);

export const customToolsSchema = z
  .array(customToolSchema)
  .max(16)
  .default([])
  .refine(
    (tools) => new Set(tools.map((tool) => tool.name)).size === tools.length,
    'Tool names must be unique',
  );

/** The spec sent to the provider. Strict JSON Schema, as the built-in tools use. */
export function customToolSpec(tool: CustomTool): ToolSpec {
  const { $schema: _drop, ...parameters } = zodToJsonSchema(tool.parameters, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  return { name: tool.name, description: tool.description, parameters };
}

/** A tool that hangs must not hold the reply open. */
export const CUSTOM_TOOL_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_CHARS = 4_000;

/**
 * Runs a custom tool call. Bad arguments, a thrown error or a timeout become
 * a short text for the model, so the reply always continues. Error details go
 * to the server log, never to the model or the visitor.
 */
export async function runCustomTool(
  tool: CustomTool,
  call: ToolCall,
  ctx: { catalog: CatalogItem[]; signal?: AbortSignal },
): Promise<string> {
  const input = tool.parameters.safeParse(call.input);
  if (!input.success) {
    return `Invalid arguments: ${input.error.issues.map((issue) => `${issue.path.join('.') || 'input'} ${issue.message}`).join('; ')}. Answer without this tool.`;
  }
  const timeout = AbortSignal.timeout(CUSTOM_TOOL_TIMEOUT_MS);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
  try {
    const output = await Promise.race([
      Promise.resolve(tool.run(input.data, { catalog: ctx.catalog, signal })),
      new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('timed out')), { once: true });
      }),
    ]);
    const text = String(output).trim() || 'No result.';
    return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS - 1)}…` : text;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'ai-chat.tool_error',
        tool: tool.name,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return 'The tool failed. Answer without it and offer to contact the team if needed.';
  }
}
