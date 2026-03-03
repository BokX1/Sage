/**
 * @module tests/vitest.setup
 * @description Defines the vitest.setup module.
 */
import { afterEach, beforeAll, beforeEach, vi } from 'vitest';

type EnvSnapshot = Record<string, string | undefined>;

const mockLogger = vi.hoisted(() => {
  const base = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  };
  return base;
});

const mockChildLogger = vi.hoisted(() => vi.fn(() => mockLogger));

vi.mock('@/shared/logging/logger', () => ({
  logger: mockLogger,
  childLogger: mockChildLogger,
}));

vi.mock('@/core/utils/logger', () => ({
  logger: mockLogger,
  childLogger: mockChildLogger,
}));

let envSnapshot: EnvSnapshot = {};

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

beforeEach(() => {
  envSnapshot = { ...process.env };
  mockLogger.child.mockImplementation(() => mockLogger);
  mockChildLogger.mockImplementation(() => mockLogger);
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, envSnapshot);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
