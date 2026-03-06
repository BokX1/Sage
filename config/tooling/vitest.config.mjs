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
    exclude: ['dist/**', 'node_modules/**'],
    setupFiles: ['tests/vitest.setup.ts'],
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    unstubGlobals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts', 'tests/integration/**/*.spec.ts'],
        },
      },
    ],
  },
});
