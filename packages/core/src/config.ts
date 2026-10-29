import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { customToolsSchema } from './custom-tool.js';
import { catalogItemSchema } from './catalog.js';

export const LANGUAGES = ['es', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const PROVIDERS = ['anthropic', 'openai'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

/** Default model per provider. OpenAI has none: the site must choose one with AI_CHAT_MODEL. */
export const DEFAULT_MODELS: Partial<Record<ProviderName, string>> = {
  anthropic: 'claude-haiku-5-5',
};

const API_KEY_VARS = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
} as const satisfies Record<ProviderName, string>;

/** WhatsApp numbers in international format, digits only (an optional leading + is stripped). */
const whatsappNumber = z
  .string()
  .transform((value) => value.replace(/^\+/, ''))
  .pipe(
    z.string().regex(/^\d{8,15}$/, 'Use international format with digits only, e.g. 584121234567'),
  );

const languageSchema = z.enum(LANGUAGES);

const companySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  website: z.string().url().optional(),
  contact: z
    .object({
      email: z.string().email().optional(),
      whatsapp: whatsappNumber.optional(),
    })
    .default({}),
  hours: z.string().optional(),
});

const languagesSchema = z
  .object({
    supported: z.array(languageSchema).nonempty().default(['es', 'en']),
    default: languageSchema.default('es'),
    tone: z.string().optional(),
  })
  .default({})
  .refine((langs) => langs.supported.includes(langs.default), {
    message: 'languages.default must be one of languages.supported',
    path: ['default'],
  });

/** A text given once, or once per UI language. */
const localized = z.union([
  z.string().min(1),
  z.object({ es: z.string().min(1).optional(), en: z.string().min(1).optional() }),
]);

const STARTER_ICONS = [
  'chat',
  'package',
  'grid',
  'truck',
  'receipt',
  'help',
  'clock',
  'pin',
  'tag',
  'mail',
] as const;

const starter = z.union([
  z.string().min(1),
  z.object({
    label: z.string().min(1),
    icon: z.enum(STARTER_ICONS).optional(),
    message: z.string().min(1).optional(),
  }),
]);

/** What the widget shows, served to it by `GET` on the endpoint. Mirrors the widget's `WidgetConfig`. */
export const widgetSchema = z
  .object({
    name: z.string().min(1).optional(),
    avatar: z.string().url().optional(),
    greeting: localized.optional(),
    starters: z
      .union([
        z.array(starter),
        z.object({ es: z.array(starter).optional(), en: z.array(starter).optional() }),
      ])
      .optional(),
    teaser: localized.optional(),
    handoff: z.object({ href: z.string().min(1), label: localized.optional() }).optional(),
  })
  .default({});

/**
 * The part of the config a site owner may edit from a dashboard. Everything
 * else (limits, origins, webhooks, the knowledge folder) is deploy config and
 * stays in code, so a dashboard can never loosen the guardrails.
 */
export const siteSettingsSchema = z.object({
  company: companySchema,
  languages: languagesSchema,
  widget: widgetSchema,
});

export const configSchema = z.object({
  company: companySchema,
  /** Folder of `.md` files. Optional when a source supplies the knowledge. */
  knowledgeDir: z.string().min(1).optional(),
  /** Products the assistant can search and show as cards. A source's catalog replaces it. */
  catalog: z.array(catalogItemSchema).optional(),
  languages: languagesSchema,
  widget: widgetSchema,
  features: z
    .object({
      /** Reply chips after answers. */
      suggestions: z.boolean().default(true),
      /** Sends lead form submissions to this URL, signed with AI_CHAT_LEAD_WEBHOOK_SECRET. */
      leadCapture: z.object({ webhookUrl: z.string().url() }).optional(),
      handoff: z
        .object({
          whatsapp: whatsappNumber.optional(),
          email: z.string().email().optional(),
        })
        .optional(),
    })
    .default({}),
  limits: z
    .object({
      maxMessageChars: z.number().int().positive().default(2000),
      /** All messages of a conversation together, assistant replies included. */
      maxConversationChars: z.number().int().positive().default(20_000),
      maxTurns: z.number().int().positive().default(20),
      maxBodyBytes: z.number().int().positive().default(100_000),
      rpmPerIp: z.number().int().positive().default(10),
      /** All visitors together: a ceiling that holds even if IPs are forged. */
      rpmGlobal: z.number().int().positive().default(60),
      maxConcurrentPerIp: z.number().int().positive().default(2),
      maxTokens: z.number().int().positive().default(1024),
      /** Weighted tokens per UTC day across all visitors (see weightedTokens). 0 turns it off. */
      dailyTokenBudget: z.number().int().nonnegative().default(1_000_000),
      /** All knowledge documents together. Every request sends them, so this bounds its cost. */
      maxKnowledgeChars: z.number().int().positive().default(200_000),
      /** Catalog items. They stay out of the prompt (the search tool reaches them), so this only bounds memory. */
      maxCatalogItems: z.number().int().positive().default(5_000),
    })
    .default({}),
  /** Sites allowed to embed the chat. Empty: only the endpoint's own origin. */
  allowedOrigins: z.array(z.string().url()).default([]),
  /** The site's own server-side tools (see defineTool). */
  tools: customToolsSchema,
});

/** What a site writes in its `ai-chat.config.ts`. */
export type ChatConfigInput = z.input<typeof configSchema>;
/** The validated config with defaults applied. */
export type ChatConfig = z.output<typeof configSchema>;
/** What a dashboard edits and a source returns. */
export type SiteSettingsInput = z.input<typeof siteSettingsSchema>;
export type SiteSettings = z.output<typeof siteSettingsSchema>;
export type WidgetSettings = z.output<typeof widgetSchema>;

/**
 * The site settings as JSON Schema (draft 7), for dashboards that generate or
 * validate forms on their side. Server-side, validate with `validateSiteSettings`.
 */
export const siteSettingsJsonSchema = zodToJsonSchema(siteSettingsSchema, {
  $refStrategy: 'none',
  pipeStrategy: 'input',
});

export interface ValidationIssue {
  /** Dotted field path, e.g. `company.contact.email`. Empty for the whole object. */
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

function validate<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  input: unknown,
): ValidationResult<T> {
  const result = schema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: toIssues(result.error) };
}

/** Checks a dashboard's settings form without throwing: one issue per invalid field. */
export function validateSiteSettings(input: unknown): ValidationResult<SiteSettings> {
  return validate(siteSettingsSchema, input);
}

/** Like `defineConfig`, but returns the issues instead of throwing. */
export function validateConfig(input: unknown): ValidationResult<ChatConfig> {
  return validate(configSchema, input);
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function formatIssues(error: z.ZodError): string {
  return toIssues(error)
    .map((issue) => `  - ${issue.path || '(root)'}: ${issue.message}`)
    .join('\n');
}

/** Validates a site config and applies defaults. Throws a ConfigError listing every invalid field. */
export function defineConfig(input: ChatConfigInput): ChatConfig {
  const result = configSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError(`Invalid ai-chat config:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

const optionalString = z
  .string()
  .optional()
  .transform((value) => value || undefined);

const envSchema = z
  .object({
    AI_CHAT_PROVIDER: z.enum(PROVIDERS).default('anthropic'),
    ANTHROPIC_API_KEY: optionalString,
    OPENAI_API_KEY: optionalString,
    AI_CHAT_MODEL: optionalString,
    AI_CHAT_LEAD_WEBHOOK_SECRET: optionalString,
  })
  .superRefine((env, ctx) => {
    const keyVar = API_KEY_VARS[env.AI_CHAT_PROVIDER];
    if (!env[keyVar]) {
      ctx.addIssue({ code: 'custom', path: [keyVar], message: 'is required' });
    }
    if (!env.AI_CHAT_MODEL && !DEFAULT_MODELS[env.AI_CHAT_PROVIDER]) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_CHAT_MODEL'],
        message: `is required when AI_CHAT_PROVIDER=${env.AI_CHAT_PROVIDER}`,
      });
    }
  });

export interface ChatEnv {
  provider: ProviderName;
  apiKey: string;
  model: string;
  leadWebhookSecret?: string;
}

/** Reads ai-chat settings from environment variables. Error messages never include secret values. */
export function loadEnv(env: Record<string, string | undefined> = process.env): ChatEnv {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(`Invalid ai-chat environment:\n${formatIssues(result.error)}`);
  }
  const data = result.data;
  const provider = data.AI_CHAT_PROVIDER;
  // Both are guaranteed by the refinement above.
  return {
    provider,
    apiKey: data[API_KEY_VARS[provider]] as string,
    model: (data.AI_CHAT_MODEL ?? DEFAULT_MODELS[provider]) as string,
    leadWebhookSecret: data.AI_CHAT_LEAD_WEBHOOK_SECRET,
  };
}
