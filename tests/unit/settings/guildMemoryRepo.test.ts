/**
 * @module tests/unit/settings/guildMemoryRepo.test
 * @description Defines the guild memory repo.test module.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUniqueMock = vi.hoisted(() => vi.fn());
const upsertMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());
const archiveCreateMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() =>
  vi.fn(async (callback: (tx: {
    guildMemory: {
      findUnique: typeof findUniqueMock;
      upsert: typeof upsertMock;
      delete: typeof deleteMock;
    };
    guildMemoryArchive: {
      create: typeof archiveCreateMock;
    };
  }) => Promise<unknown>) =>
    callback({
      guildMemory: {
        findUnique: findUniqueMock,
        upsert: upsertMock,
        delete: deleteMock,
      },
      guildMemoryArchive: {
        create: archiveCreateMock,
      },
    })));

vi.mock('../../../src/core/db/prisma-client', () => ({
  prisma: {
    guildMemory: {
      findUnique: findUniqueMock,
      upsert: upsertMock,
      delete: deleteMock,
    },
    guildMemoryArchive: {
      create: archiveCreateMock,
    },
    $transaction: transactionMock,
  },
}));

describe('guildMemoryRepo', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { __clearGuildMemoryCacheForTests } = await import('../../../src/core/settings/guildMemoryRepo');
    __clearGuildMemoryCacheForTests();
  });

  it('caches guild memory lookups for the TTL window', async () => {
    findUniqueMock.mockResolvedValue({
      guildId: 'guild-1',
      memoryText: 'QA bot mode',
      version: 2,
      updatedByAdminId: 'admin-1',
      updatedAt: new Date('2026-02-26T00:00:00.000Z'),
      createdAt: new Date('2026-02-25T00:00:00.000Z'),
    });

    const { getGuildMemoryRecord } = await import('../../../src/core/settings/guildMemoryRepo');
    const first = await getGuildMemoryRecord('guild-1');
    const second = await getGuildMemoryRecord('guild-1');

    expect(first?.memoryText).toBe('QA bot mode');
    expect(second?.memoryText).toBe('QA bot mode');
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
  });

  it('archives previous memory when upserting', async () => {
    findUniqueMock.mockResolvedValueOnce({
      guildId: 'guild-1',
      memoryText: 'old memory',
      version: 3,
      updatedByAdminId: 'admin-old',
      updatedAt: new Date('2026-02-20T00:00:00.000Z'),
      createdAt: new Date('2026-02-19T00:00:00.000Z'),
    });
    upsertMock.mockResolvedValueOnce({
      guildId: 'guild-1',
      memoryText: 'new memory',
      version: 4,
      updatedByAdminId: 'admin-new',
      updatedAt: new Date('2026-02-26T00:00:00.000Z'),
      createdAt: new Date('2026-02-19T00:00:00.000Z'),
    });

    const { upsertGuildMemory } = await import('../../../src/core/settings/guildMemoryRepo');
    const result = await upsertGuildMemory({
      guildId: 'guild-1',
      memoryText: 'new memory',
      adminId: 'admin-new',
    });

    expect(result.version).toBe(4);
    expect(archiveCreateMock).toHaveBeenCalledWith({
      data: {
        guildId: 'guild-1',
        version: 3,
        memoryText: 'old memory',
        updatedByAdminId: 'admin-old',
      },
    });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          version: 4,
        }),
      }),
    );
  });
});
