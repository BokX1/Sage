import { vi } from 'vitest';

export type FetchMock = ReturnType<typeof vi.fn>;

export function stubFetch(): FetchMock {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

