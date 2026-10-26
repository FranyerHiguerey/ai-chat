/**
 * A reference dashboard: a site owner edits the bot's settings and knowledge,
 * and the chat on /api/chat picks the changes up without a redeploy. It shows
 * the ai-chat hooks working together; it is not a product.
 *
 * Run with `pnpm admin` from the repo root. Needs ADMIN_PASSWORD in .env.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import {
  cachedSource,
  createChatHandler,
  defineConfig,
  folderSource,
  loadEnv,
  validateSiteSettings,
  type ChatEnv,
} from '@franyerhiguerey/ai-chat-core';
import { IngestError, toKnowledgeDoc } from '@franyerhiguerey/ai-chat-ingest';
import { page } from './html.js';
import { createStorage, isDocName } from './storage.js';
import { formToSettings, knowledgePage, previewPage, settingsPage } from './views.js';

const here = path.dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(path.join(here, '../../.env'));
} catch {
  // No .env file: use the environment as is.
}

const storage = createStorage(path.join(here, 'data'), path.join(here, 'seed'));
await storage.init();

/**
 * Deploy config: stays in code. The dashboard only edits the site settings,
 * which override `company`, `languages` and `widget`. The company below is the
 * fallback until settings.json is valid.
 */
const config = defineConfig({
  company: { name: 'Acme Packaging', description: 'Plastic containers.' },
  limits: { dailyTokenBudget: 200_000 },
});

let env: ChatEnv | undefined;
try {
  env = loadEnv();
} catch (error) {
  console.warn(`${(error as Error).message}\nThe dashboard works; the chat needs a key in .env.`);
}

const handleChat = env
  ? createChatHandler({
      config,
      env,
      source: cachedSource(folderSource({ dir: storage.dir }), { ttlMs: 5_000 }),
    })
  : () =>
      Response.json(
        { error: { code: 'internal', message: 'No API key configured.' } },
        { status: 500 },
      );

const widgetPath = path.join(
  path.dirname(fileURLToPath(import.meta.resolve('@franyerhiguerey/ai-chat-widget'))),
  'ai-chat.global.js',
);

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

// --- Access control -------------------------------------------------------

const digest = (text: string) => createHash('sha256').update(text).digest();

/** HTTP Basic auth against ADMIN_PASSWORD (any user name). Refuses everything when it isn't set. */
function authorized(request: Request): boolean {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const given = decoded.slice(decoded.indexOf(':') + 1);
  return timingSafeEqual(digest(given), digest(password));
}

const unauthorized = () =>
  new Response(
    process.env.ADMIN_PASSWORD ? 'Sign in required' : 'Set ADMIN_PASSWORD in .env first',
    {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="ai-chat admin", charset="UTF-8"' },
    },
  );

/**
 * Browsers resend Basic credentials automatically, so another site could post
 * a form here on the owner's behalf. Admin writes must come from our own pages.
 */
const sameOrigin = (request: Request) =>
  request.headers.get('origin') === new URL(request.url).origin;

const redirect = (location: string) =>
  new Response(null, { status: 303, headers: { Location: location } });

// --- Admin routes ---------------------------------------------------------

async function admin(request: Request, pathname: string): Promise<Response> {
  if (!authorized(request)) return unauthorized();
  if (request.method === 'POST') {
    if (!sameOrigin(request)) return new Response('Cross-site request refused', { status: 403 });
    if (Number(request.headers.get('content-length')) > MAX_UPLOAD_BYTES) {
      return new Response('Upload too large', { status: 413 });
    }
  }

  if (pathname === '/admin') {
    if (request.method === 'POST') {
      const input = formToSettings(await request.formData());
      const result = validateSiteSettings(input);
      if (!result.ok) return page(settingsPage(input, result.issues), 400);
      await storage.saveSettings(result.value);
      return redirect('/admin?saved=1');
    }
    const saved = new URL(request.url).searchParams.has('saved');
    return page(settingsPage(await storage.readSettings().catch(() => ({})), [], saved));
  }

  if (pathname === '/admin/knowledge') {
    const messages = { ok: [] as string[], errors: [] as string[] };
    if (request.method === 'POST') {
      const form = await request.formData();
      for (const file of form.getAll('files')) {
        if (typeof file === 'string' || !file.name) continue;
        try {
          const doc = await toKnowledgeDoc({
            name: file.name,
            type: file.type,
            bytes: new Uint8Array(await file.arrayBuffer()),
          });
          await storage.saveDoc(doc);
          messages.ok.push(`${file.name} saved as ${doc.file}.`);
        } catch (error) {
          if (!(error instanceof IngestError)) throw error;
          messages.errors.push(error.message);
        }
      }
    }
    return page(knowledgePage(await storage.listDocs(), config.limits.maxKnowledgeChars, messages));
  }

  if (pathname === '/admin/knowledge/delete' && request.method === 'POST') {
    const file = (await request.formData()).get('file');
    if (typeof file !== 'string' || !isDocName(file)) {
      return new Response('Unknown document', { status: 400 });
    }
    await storage.deleteDoc(file);
    return redirect('/admin/knowledge');
  }

  if (pathname === '/admin/preview') return page(previewPage(new URL(request.url).origin));

  return new Response('Not found', { status: 404 });
}

// --- Server ---------------------------------------------------------------

const port = Number(process.env.ADMIN_PORT ?? 4322);

serve(
  {
    port,
    fetch: async (request, { incoming }) => {
      const { pathname } = new URL(request.url);
      if (pathname === '/api/chat') {
        return handleChat(request, { clientIp: incoming.socket.remoteAddress });
      }
      if (pathname === '/widget.js' && request.method === 'GET') {
        return new Response(await readFile(widgetPath), {
          headers: {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }
      if (pathname === '/') return redirect('/admin');
      if (pathname === '/admin' || pathname.startsWith('/admin/')) {
        try {
          return await admin(request, pathname);
        } catch (error) {
          console.error(error);
          return new Response('Something went wrong; see the server log.', { status: 500 });
        }
      }
      return new Response('Not found', { status: 404 });
    },
  },
  (info) => {
    console.log(
      `ai-chat admin: http://localhost:${info.port}/admin (${env ? `${env.provider}, ${env.model}` : 'no key: chat disabled'})\n` +
        `data folder: ${storage.dir}`,
    );
  },
);
