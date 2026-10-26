# @franyerhiguerey/ai-chat-core

The server side of [ai-chat](https://github.com/FranyerHiguerey/ai-chat). It covers:

- the config, knowledge and catalog;
- sources for dashboards;
- the guardrails;
- the Claude and OpenAI providers;
- `createChatHandler()`, a web-standard `Request => Response` endpoint that streams replies over SSE.

```ts
import { createChatHandler, defineConfig, loadEnv } from '@franyerhiguerey/ai-chat-core';

const handler = createChatHandler({
  config: defineConfig({
    company: { name: 'Acme', description: 'What the company does.' },
    knowledgeDir: './knowledge',
  }),
  env: loadEnv(),
});

export const POST = (request: Request) => handler(request, { clientIp: '…' });
```

Install the SDK for your provider next to it: `@anthropic-ai/sdk` (the default) or `openai`. The API key is read from the server environment, and only there.

See the [integration guide](https://github.com/FranyerHiguerey/ai-chat/blob/main/docs/integration.md) for the frameworks, guardrails, dashboards, catalog and leads, and the [protocol](https://github.com/FranyerHiguerey/ai-chat/blob/main/docs/protocol.md) for writing your own client.
