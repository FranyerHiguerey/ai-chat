import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // Protocol types come from core (an optional peer dependency, types only).
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
