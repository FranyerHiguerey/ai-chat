/**
 * Manual check against the real API of the provider set in .env (costs a
 * fraction of a cent on small models). Sends the same question twice and passes
 * when the second call reads the system prompt from the cache.
 *
 *   pnpm --filter @franyerhiguerey/ai-chat-core live-check
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChatClient, defineConfig, loadEnv, type UsageReport } from '../src/index.js';

const PRODUCTS = ['bottles', 'jars', 'caps', 'trays', 'buckets', 'films', 'bags', 'crates'];

// About 2K tokens of synthetic knowledge: above the cache minimum of both
// providers (512 tokens on Haiku 5.5, 1,024 on OpenAI).
function catalog(): string {
  return PRODUCTS.map((product, i) =>
    [
      `## ${product[0]?.toUpperCase()}${product.slice(1)}`,
      `Our ${product} are made from food-grade HDPE and PP. Minimum order is ${(i + 1) * 500} units.`,
      `Standard lead time is ${5 + i} business days; rush orders ship in ${2 + (i % 3)} days for a surcharge.`,
      `Custom colors, logos and sizes are available. Ask for a quote with the quantity, size and color you need.`,
      `All ${product} can be recycled and we accept returns of defective units within 30 days of delivery.`,
    ].join('\n'),
  ).join('\n\n');
}

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-chat-live-'));
  try {
    await writeFile(path.join(dir, 'catalog.md'), `# Product catalog\n\n${catalog()}`.repeat(3));
    await writeFile(
      path.join(dir, 'faq.md'),
      '# FAQ\n\nQ: Do you ship nationwide?\nA: Yes. Orders over 2,000 units ship free.\n',
    );

    const env = loadEnv();
    console.log(`Provider: ${env.provider}, model: ${env.model}`);

    const usages: UsageReport[] = [];
    const chat = await createChatClient({
      config: defineConfig({
        company: {
          name: 'Acme Plastics (live check)',
          description: 'Fictional plastic packaging manufacturer used to test ai-chat.',
          contact: { email: 'hello@acme.test' },
        },
        knowledgeDir: dir,
      }),
      env,
      onUsage: (usage) => usages.push(usage),
    });

    for (const attempt of [1, 2]) {
      const result = await chat.ask([
        {
          role: 'user',
          content: '¿Cuál es el pedido mínimo de frascos y cuánto tarda la entrega?',
        },
      ]);
      console.log(`\n--- call ${attempt} (${result.finishReason}) ---\n${result.text}`);
      console.log(usages.at(-1));
    }

    const second = usages[1];
    if (!second || second.cacheReadInputTokens === 0) {
      console.error('\nFAIL: the second call did not read from the cache.');
      process.exitCode = 1;
    } else {
      console.log(`\nPASS: ${second.cacheReadInputTokens} tokens read from cache on call 2.`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
