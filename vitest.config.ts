import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      // Ships only a `module` entry (no `main`/`exports`), which vitest's node
      // resolver does not pick up; the browser build resolves it fine.
      '@picovoice/web-voice-processor': resolve(
        __dirname,
        'node_modules/@picovoice/web-voice-processor/dist/esm/index.js',
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
