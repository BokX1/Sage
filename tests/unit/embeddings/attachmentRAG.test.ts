/**
 * @module tests/unit/embeddings/attachmentRAG.test
 * @description Validates attachment RAG search normalization paths.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQueryRaw = vi.hoisted(() => vi.fn());
const mockExecuteRaw = vi.hoisted(() => vi.fn());
const mockEmbedText = vi.hoisted(() => vi.fn(async () => [0.1, 0.2, 0.3]));

vi.mock('../../../src/core/db/prisma-client', () => ({
  prisma: {
    $queryRaw: mockQueryRaw,
    $executeRaw: mockExecuteRaw,
  },
}));

vi.mock('../../../src/core/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/core/embeddings/embeddingEngine', () => ({
  embedText: mockEmbedText,
  embedTexts: vi.fn(),
}));

import {
  __resetAttachmentRagCapabilitiesForTests,
  searchAttachments,
} from '../../../src/core/embeddings/attachmentRAG';

function makeSearchRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'chunk-1',
    attachmentId: 'attachment-1',
    content: 'example chunk',
    score: 0.8,
    ...overrides,
  };
}

describe('attachmentRAG searchAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAttachmentRagCapabilitiesForTests();
  });

  it('returns early for blank queries', async () => {
    const rows = await searchAttachments('   ', 10);

    expect(rows).toEqual([]);
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  it('falls back to default topK when lexical search limit is non-finite', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([makeSearchRow()]);

    const rows = await searchAttachments('needle', Number.NaN as unknown as number);

    expect(rows).toHaveLength(1);
    const lexicalLimit = mockQueryRaw.mock.calls[1]?.at(-1);
    expect(lexicalLimit).toBe(5);
  });

  it('trims semantic query input and bounds non-finite topK', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([makeSearchRow()]);

    const rows = await searchAttachments('  semantic query  ', Number.POSITIVE_INFINITY);

    expect(rows).toHaveLength(1);
    expect(mockEmbedText).toHaveBeenCalledWith('semantic query', 'query');
    const semanticLimit = mockQueryRaw.mock.calls[1]?.at(-1);
    expect(semanticLimit).toBe(5);
  });
});
