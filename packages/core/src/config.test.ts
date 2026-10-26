import { describe, expect, it } from 'vitest';
import { ConfigError, defineConfig, loadEnv } from './config.js';
import { testConfig } from '../test/helpers.js';

describe('defineConfig', () => {
  it('applies defaults', () => {
    const config = testConfig();
    expect(config.languages).toEqual({ supported: ['es', 'en'], default: 'es' });
    expect(config.limits).toEqual({
      maxMessageChars: 2000,
      maxTurns: 20,
      rpmPerIp: 10,
      maxTokens: 1024,
    });
    expect(config.features).toEqual({});
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
