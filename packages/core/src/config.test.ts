import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  defineConfig,
  loadEnv,
  siteSettingsJsonSchema,
  validateSiteSettings,
} from './config.js';
import { testConfig } from '../test/helpers.js';

describe('defineConfig', () => {
  it('applies defaults', () => {
    const config = testConfig();
    expect(config.languages).toEqual({ supported: ['es', 'en'], default: 'es' });
    expect(config.limits).toEqual({
      maxMessageChars: 2000,
      maxConversationChars: 20_000,
      maxTurns: 20,
      maxBodyBytes: 100_000,
      rpmPerIp: 10,
      rpmGlobal: 60,
      maxConcurrentPerIp: 2,
      maxTokens: 1024,
      dailyTokenBudget: 1_000_000,
      maxKnowledgeChars: 200_000,
    });
    expect(config.widget).toEqual({});
    expect(config.features).toEqual({ suggestions: true });
    expect(config.allowedOrigins).toEqual([]);
  });

  it('strips the leading + from WhatsApp numbers', () => {
    expect(testConfig().company.contact.whatsapp).toBe('584121234567');
  });

  it('lists every invalid field', () => {
    const run = () =>
      defineConfig({
        company: { name: '', description: 'x', contact: { email: 'not-an-email' } },
        knowledgeDir: 'k',
        allowedOrigins: ['nope'],
      });
    expect(run).toThrow(ConfigError);
    expect(run).toThrow(/company\.name/);
    expect(run).toThrow(/company\.contact\.email/);
    expect(run).toThrow(/allowedOrigins\.0/);
  });

  it('rejects a default language that is not supported', () => {
    expect(() => testConfig({ languages: { supported: ['en'], default: 'es' } })).toThrow(
      /languages\.default/,
    );
  });

  it('rejects malformed WhatsApp numbers', () => {
    expect(() => testConfig({ features: { handoff: { whatsapp: '0412-123-4567' } } })).toThrow(
      /features\.handoff\.whatsapp/,
    );
  });
});

describe('loadEnv', () => {
  it('defaults to Anthropic with Haiku 5.5 and no webhook secret', () => {
    expect(loadEnv({ ANTHROPIC_API_KEY: 'sk-test', AI_CHAT_MODEL: '' })).toEqual({
      provider: 'anthropic',
      apiKey: 'sk-test',
      model: 'claude-haiku-5-5',
      leadWebhookSecret: undefined,
    });
  });

  it('reads overrides', () => {
    const env = loadEnv({
      ANTHROPIC_API_KEY: 'sk-test',
      AI_CHAT_MODEL: 'claude-sonnet-5-5',
      AI_CHAT_LEAD_WEBHOOK_SECRET: 'shh',
    });
    expect(env.model).toBe('claude-sonnet-5-5');
    expect(env.leadWebhookSecret).toBe('shh');
  });

  it('uses the OpenAI key and model when the provider is openai', () => {
    expect(
      loadEnv({
        AI_CHAT_PROVIDER: 'openai',
        ANTHROPIC_API_KEY: 'sk-ant',
        OPENAI_API_KEY: 'sk-oai',
        AI_CHAT_MODEL: 'gpt-test',
      }),
    ).toMatchObject({ provider: 'openai', apiKey: 'sk-oai', model: 'gpt-test' });
  });

  it('requires a model for openai, since it has no default', () => {
    expect(() => loadEnv({ AI_CHAT_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-oai' })).toThrow(
      /AI_CHAT_MODEL: is required when AI_CHAT_PROVIDER=openai/,
    );
  });

  it("fails clearly when the selected provider's key is missing", () => {
    expect(() => loadEnv({})).toThrow(/ANTHROPIC_API_KEY: is required/);
    expect(() =>
      loadEnv({ AI_CHAT_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'sk-ant', AI_CHAT_MODEL: 'm' }),
    ).toThrow(/OPENAI_API_KEY: is required/);
  });

  it('rejects unknown providers', () => {
    expect(() => loadEnv({ AI_CHAT_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'k' })).toThrow(
      /AI_CHAT_PROVIDER/,
    );
  });

  it('never echoes secrets in errors', () => {
    try {
      loadEnv({ AI_CHAT_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-secret-value' });
    } catch (error) {
      expect(String(error)).not.toContain('sk-secret-value');
      return;
    }
    throw new Error('expected loadEnv to throw');
  });
});

describe('validateSiteSettings', () => {
  const valid = {
    company: { name: 'Acme', description: 'Envases.', contact: { whatsapp: '+584121234567' } },
    widget: {
      greeting: { es: '¡Hola!' },
      starters: ['¿Hacen envíos?', { label: 'Precios', icon: 'tag' }],
    },
  };

  it('applies defaults and drops keys that are not site settings', () => {
    const result = validateSiteSettings({ ...valid, limits: { maxTurns: 999 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.company.contact.whatsapp).toBe('584121234567');
    expect(result.value.languages.default).toBe('es');
    expect(result.value).not.toHaveProperty('limits');
  });

  it('returns one issue per invalid field instead of throwing', () => {
    const result = validateSiteSettings({
      company: { name: '', description: 'x', contact: { email: 'not-an-email' } },
      widget: { avatar: 'nope', starters: [{ label: 'x', icon: 'rocket' }] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path).sort()).toEqual([
      'company.contact.email',
      'company.name',
      'widget.avatar',
      'widget.starters',
    ]);
  });
});

describe('siteSettingsJsonSchema', () => {
  it('describes the editable fields for form builders', () => {
    const schema = siteSettingsJsonSchema as {
      properties: Record<string, { properties?: Record<string, unknown> }>;
      required: string[];
    };
    expect(Object.keys(schema.properties).sort()).toEqual(['company', 'languages', 'widget']);
    expect(schema.required).toEqual(['company']);
    expect(Object.keys(schema.properties.company?.properties ?? {})).toContain('contact');
  });
});
