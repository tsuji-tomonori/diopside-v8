import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/diopside-v8/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    outDir: 'docs',
    // 要件・生成設計も docs 配下で追跡するため、サイト生成物だけを
    // scripts/prepare-site.ts で消してから上書きする。
    emptyOutDir: false,
    sourcemap: false,
    target: 'es2022',
  },
});
