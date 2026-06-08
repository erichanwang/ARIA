import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'node:path';
import manifest from './manifest.config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  plugins: [crx({ manifest })],
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      input: {
        // Extra HTML entry points the manifest doesn't reference directly.
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
      },
    },
  },
  // CRXJS needs a stable port for HMR of the content script.
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
