import { afterEach, describe, expect, it, vi } from 'vitest';

const mockLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('embeddingEngine dimension guard', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('loads when configured dimensions match vector schema', async () => {
    vi.doMock('@/platform/config/env', () => ({
      config: {
        EMBEDDING_MODEL: 'nomic-ai/nomic-embed-text-v1.5',
        EMBEDDING_DIMENSIONS: 256,
      },
    }));
    vi.doMock('@/platform/logging/logger', () => ({ logger: mockLogger }));

    const module = await import('../../../../src/features/embeddings/embeddingEngine');
    expect(module.EMBEDDING_DIMENSIONS).toBe(256);
  });

  it('throws if configured dimensions do not match vector(256) schema', async () => {
    vi.doMock('@/platform/config/env', () => ({
      config: {
        EMBEDDING_MODEL: 'nomic-ai/nomic-embed-text-v1.5',
        EMBEDDING_DIMENSIONS: 128,
      },
    }));
    vi.doMock('@/platform/logging/logger', () => ({ logger: mockLogger }));

    await expect(import('../../../../src/features/embeddings/embeddingEngine')).rejects.toThrow(
      'EMBEDDING_DIMENSIONS=128 is not supported',
    );
  });

  it('throws when embedding output has fewer dimensions than required', async () => {
    const shortVector = Array.from({ length: 128 }, (_, idx) => idx);
    const mockPipe = vi.fn(async () => ({ tolist: () => [shortVector] }));

    vi.doMock('@/platform/config/env', () => ({
      config: {
        EMBEDDING_MODEL: 'nomic-ai/nomic-embed-text-v1.5',
        EMBEDDING_DIMENSIONS: 256,
      },
    }));
    vi.doMock('@/platform/logging/logger', () => ({ logger: mockLogger }));
    vi.doMock('@huggingface/transformers', () => ({
      pipeline: vi.fn(async () => mockPipe),
    }));

    const module = await import('../../../../src/features/embeddings/embeddingEngine');
    await expect(module.embedTexts(['hello world'], 'document')).rejects.toThrow(
      'Embedding model returned 128 dimensions; expected at least 256.',
    );
  });
});
