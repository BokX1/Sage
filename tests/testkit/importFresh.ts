/**
 * @module tests/testkit/importFresh
 * @description Defines the import fresh module.
 */
import { vi } from 'vitest';

/**
 * Runs importFresh.
 *
 * @param importer - Describes the importer input.
 * @returns Returns the function result.
 */
export async function importFresh<T>(importer: () => Promise<T>): Promise<T> {
  vi.resetModules();
  return importer();
}

