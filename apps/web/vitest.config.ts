import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Next resolves this from tsconfig paths; Vitest needs it stated here too.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Playwright specs live in e2e/ and are driven by a different runner. Without this
    // exclusion Vitest collects them and fails on the Playwright imports.
    exclude: ['node_modules/**', 'e2e/**', '.next/**'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
