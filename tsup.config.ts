import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.test.ts'],
  format: ['esm'],
  dts: false,
  outDir: 'dist',
  splitting: false,
  bundle: false,
  clean: true,
});
