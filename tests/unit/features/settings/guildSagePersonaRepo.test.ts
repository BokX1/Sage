import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUniqueMock = vi.hoisted(() => vi.fn());
const upsertMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());
const archiveCreateMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() =>
  vi.fn(async (callback: (tx: {
    serverInstructions: {
      findUnique: typeof findUniqueMock;
      upsert: typeof upsertMock;
      delete: typeof deleteMock;
    };
    serverInstructionsArchive: {
      create: typeof archiveCreateMock;
    };
  }) => Promise<unknown>) =>
    callback({
      serverInstructions: {
        findUnique: findUniqueMock,
        upsert: upsertMock,
        delete: deleteMock,
      },
      serverInstructionsArchive: {
        create: archiveCreateMock,
      },
    })));

vi.mock('@/platform/db/prisma-client', () => ({
  prisma: {
    serverInstructions: {
      findUnique: findUniqueMock,
      upsert: upsertMock,
      delete: deleteMock,
    },
    serverInstructionsArchive: {
      create: archiveCreateMock,
    },
    $transaction: transactionMock,
  },
}));

describe('guildSagePersonaRepo', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { __clearGuildSagePersonaCacheForTests } = await import('../../../../src/features/settings/guildSagePersonaRepo');
    __clearGuildSagePersonaCacheForTests();
  });

  it('caches guild Sage Persona lookups for the TTL window', async () => {
    findUniqueMock.mockResolvedValue({
      guildId: 'guild-1',
      instructionsText: 'QA bot mode',
      version: 2,
      updatedByAdminId: 'admin-1',
      updatedAt: new Date('2026-02-26T00:00:00.000Z'),
      createdAt: new Date('2026-02-25T00:00:00.000Z'),
    });

    const { getGuildSagePersonaRecord } = await import('../../../../src/features/settings/guildSagePersonaRepo');
    const first = await getGuildSagePersonaRecord('guild-1');
    const second = await getGuildSagePersonaRecord('guild-1');

    expect(first?.instructionsText).toBe('QA bot mode');
    expect(second?.instructionsText).toBe('QA bot mode');
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
  });

  it('archives previous instructions when upserting', async () => {
    findUniqueMock.mockResolvedValueOnce({
      guildId: 'guild-1',
      instructionsText: 'old instructions',
      version: 3,
      updatedByAdminId: 'admin-old',
      updatedAt: new Date('2026-02-20T00:00:00.000Z'),
      createdAt: new Date('2026-02-19T00:00:00.000Z'),
    });
    upsertMock.mockResolvedValueOnce({
      guildId: 'guild-1',
      instructionsText: 'new instructions',
      version: 4,
      updatedByAdminId: 'admin-new',
      updatedAt: new Date('2026-02-26T00:00:00.000Z'),
      createdAt: new Date('2026-02-19T00:00:00.000Z'),
    });

    const { upsertGuildSagePersona } = await import('../../../../src/features/settings/guildSagePersonaRepo');
    const result = await upsertGuildSagePersona({
      guildId: 'guild-1',
      instructionsText: 'new instructions',
      adminId: 'admin-new',
    });

    expect(result.version).toBe(4);
    expect(archiveCreateMock).toHaveBeenCalledWith({
      data: {
        guildId: 'guild-1',
        version: 3,
        instructionsText: 'old instructions',
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
