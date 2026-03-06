import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const noDirectEnvRule = [
  'error',
  {
    object: 'process',
    property: 'env',
    message: 'Use the central config module (src/platform/config/env.ts) instead of process.env directly.',
  },
];

const disallowAppImports = [
  'error',
  {
    patterns: [
      {
        regex: '^@/app/',
        message: 'Only app-layer modules may import from src/app.',
      },
      {
        regex: '^(?:\\.\\./)+app/',
        message: 'Only app-layer modules may import from src/app.',
      },
    ],
  },
];

const disallowFeatureImports = [
  'error',
  {
    patterns: [
      {
        regex: '^@/(?:app|features)/',
        message: 'Platform-layer modules must not depend on app or feature modules.',
      },
      {
        regex: '^(?:\\.\\./)+(?:app|features)/',
        message: 'Platform-layer modules must not depend on app or feature modules.',
      },
    ],
  },
];

const disallowSharedUpstreamImports = [
  'error',
  {
    patterns: [
      {
        regex: '^@/(?:app|features|platform)/',
        message: 'Shared modules must remain dependency-free from app, feature, and platform layers.',
      },
      {
        regex: '^(?:\\.\\./)+(?:app|features|platform)/',
        message: 'Shared modules must remain dependency-free from app, feature, and platform layers.',
      },
    ],
  },
];

export default [
  { files: ['../../**/*.{js,mjs,cjs,ts}'] },
  { languageOptions: { globals: globals.node } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['../../tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.tests.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['../../src/**/*.ts'],
    ignores: ['../../src/platform/config/env.ts', '../../src/cli/onboard.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.app.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      'no-restricted-properties': noDirectEnvRule,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['../../src/features/**/*.ts'],
    rules: {
      'no-restricted-imports': disallowAppImports,
    },
  },
  {
    files: ['../../src/platform/**/*.ts'],
    rules: {
      'no-restricted-imports': disallowFeatureImports,
    },
  },
  {
    files: ['../../src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': disallowSharedUpstreamImports,
    },
  },
  {
    ignores: ['../../dist/', '../../node_modules/'],
  },
];
