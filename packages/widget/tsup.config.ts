import { defineConfig } from 'tsup';

// The client is bundled in, so the widget ships as one file with no runtime dependencies.
export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
    noExternal: ['@franyerhiguerey/ai-chat-client'],
  },
  {
    // For a plain <script> tag: registers <ai-chat> and exposes window.AiChat.
    entry: { 'ai-chat': 'src/index.ts' },
    format: ['iife'],
    globalName: 'AiChat',
    minify: true,
    sourcemap: true,
    target: 'es2022',
    noExternal: ['@franyerhiguerey/ai-chat-client'],
  },
]);
