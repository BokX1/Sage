/**
 * @module tests/testkit/fetch
 * @description Defines the fetch module.
 */
import { vi } from 'vitest';

/**
 * Represents the FetchMock type.
 */
export type FetchMock = ReturnType<typeof vi.fn>;

/**
 * Runs stubFetch.
 *
 * @returns Returns the function result.
 */
export function stubFetch(): FetchMock {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

