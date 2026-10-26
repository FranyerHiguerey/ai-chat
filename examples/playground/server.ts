/**
 * A bare playground for the ai-chat stream. Serves one page, the browser
 * client, and the chat endpoint. Run with `pnpm playground` from the repo root.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import {
  createChatHandler,
  defineConfig,
  loadEnv,
  type ChatEnv,
} from '@franyerhiguerey/ai-chat-core';
import { handleMockChat } from './mock.js';

const here = path.dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(path.join(here, '../../.env'));
} catch {
  // No .env file: use the environment as is.
}

// Without a key the playground still runs: the widget page can use the mock stream.
let env: ChatEnv | undefined;
try {
  env = loadEnv();
} catch (error) {
  console.warn(`${(error as Error).message}\nNo live chat: open /widget?mock=1 to try the widget.`);
}

const handleChat = env ? createLiveHandler(env) : noKeyHandler;

function createLiveHandler(env: ChatEnv) {
  return createChatHandler({
    config: defineConfig({
      company: {
        name: 'Plastinova',
        description:
          'Fabricante venezolano de envases plásticos (botellas, frascos, tapas y bidones) para alimentos, cosmética y limpieza.',
        website: 'https://plastinova.example',
        contact: { email: 'ventas@plastinova.example', whatsapp: '+584121234567' },
        hours: 'Lunes a viernes, 8:00 a 17:00 (hora de Venezuela)',
      },
      knowledgeDir: path.join(here, 'knowledge'),
      languages: { supported: ['es', 'en'], default: 'es', tone: 'Cercano, claro y profesional.' },
    }),
    env,
  });
}

function noKeyHandler(): Response {
  const message = 'No API key configured. Add one to .env, or open /widget?mock=1.';
  return Response.json({ error: { code: 'internal', message } }, { status: 500 });
}

const clientPath = fileURLToPath(import.meta.resolve('@franyerhiguerey/ai-chat-client'));
const widgetPath = path.join(
  path.dirname(fileURLToPath(import.meta.resolve('@franyerhiguerey/ai-chat-widget'))),
  'ai-chat.global.js',
);

async function file(filePath: string, type: string): Promise<Response> {
  // Read on every request so edits show up on reload.
  return new Response(await readFile(filePath), {
    headers: { 'Content-Type': type, 'Cache-Control': 'no-store' },
  });
}

const port = Number(process.env.PORT ?? 4321);

serve(
  {
    port,
    fetch: (request, { incoming }) => {
      const { pathname } = new URL(request.url);
      if (pathname === '/api/chat') {
        return handleChat(request, { clientIp: incoming.socket.remoteAddress });
      }
      if (pathname === '/api/mock-chat' && request.method === 'POST')
        return handleMockChat(request);
      if (request.method === 'GET' && pathname === '/') {
        return file(path.join(here, 'public/index.html'), 'text/html; charset=utf-8');
      }
      if (request.method === 'GET' && pathname === '/client.js') {
        return file(clientPath, 'text/javascript; charset=utf-8');
      }
      if (request.method === 'GET' && pathname === '/widget') {
        return file(path.join(here, 'public/widget.html'), 'text/html; charset=utf-8');
      }
      if (request.method === 'GET' && pathname === '/widget.js') {
        return file(widgetPath, 'text/javascript; charset=utf-8');
      }
      return new Response('Not found', { status: 404 });
    },
  },
  (info) => {
    console.log(
      `ai-chat playground: http://localhost:${info.port} (${env ? `${env.provider}, ${env.model}` : 'no key: mock only'})\n` +
        `widget: http://localhost:${info.port}/widget (add ?mock=1 for the free fake stream)`,
    );
  },
);
