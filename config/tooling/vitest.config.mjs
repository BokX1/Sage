import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    setupFiles: ['tests/vitest.setup.ts'],
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    unstubGlobals: true,
  },
});
