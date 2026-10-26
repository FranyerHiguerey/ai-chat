import { z } from 'zod';

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

export const configSchema = z.object({
  company: z.object({
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
  }),
  knowledgeDir: z.string().min(1),
  languages: z
    .object({
      supported: z.array(languageSchema).nonempty().default(['es', 'en']),
      default: languageSchema.default('es'),
      tone: z.string().optional(),
    })
    .default({})
    .refine((langs) => langs.supported.includes(langs.default), {
      message: 'languages.default must be one of languages.supported',
      path: ['default'],
    }),
  features: z
    .object({
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
    })
    .default({}),
  /** Sites allowed to embed the chat. Empty: only the endpoint's own origin. */
  allowedOrigins: z.array(z.string().url()).default([]),
});

/** What a site writes in its `ai-chat.config.ts`. */
export type ChatConfigInput = z.input<typeof configSchema>;
/** The validated config with defaults applied. */
export type ChatConfig = z.output<typeof configSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
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
