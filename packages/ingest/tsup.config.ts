import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  // Parsers are optional peers, loaded only when a file of that type arrives.
  external: ['unpdf', 'mammoth'],
});
