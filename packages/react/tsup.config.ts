import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  // A client component in React Server Component frameworks (Next.js app router).
  banner: { js: "'use client';" },
});
