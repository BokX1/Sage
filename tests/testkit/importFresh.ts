import { vi } from 'vitest';

export async function importFresh<T>(importer: () => Promise<T>): Promise<T> {
  vi.resetModules();
  return importer();
}

