import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  base: '/ide/',
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
