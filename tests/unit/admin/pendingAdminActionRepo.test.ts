/**
 * @module tests/unit/admin/pendingAdminActionRepo.test
 * @description Defines the pending admin action repo.test module.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.hoisted(() => vi.fn());
const findUniqueMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/core/db/prisma-client', () => ({
  prisma: {
    pendingAdminAction: {
      create: createMock,
      findUnique: findUniqueMock,
      update: updateMock,
    },
  },
}));

describe('pendingAdminActionRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a pending action with pending status', async () => {
    createMock.mockResolvedValue({
      id: 'action-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedBy: 'admin-1',
      kind: 'discord_queue_moderation_action',
      payloadJson: { action: 'delete_message' },
      status: 'pending',
      expiresAt: new Date('2026-02-26T12:10:00.000Z'),
      decidedBy: null,
      decidedAt: null,
      executedAt: null,
      resultJson: null,
      errorText: null,
      createdAt: new Date('2026-02-26T12:00:00.000Z'),
      updatedAt: new Date('2026-02-26T12:00:00.000Z'),
    });

    const { createPendingAdminAction } = await import('../../../src/core/admin/pendingAdminActionRepo');
    const result = await createPendingAdminAction({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedBy: 'admin-1',
      kind: 'discord_queue_moderation_action',
      payloadJson: { action: 'delete_message' },
      expiresAt: new Date('2026-02-26T12:10:00.000Z'),
    });

    expect(result.status).toBe('pending');
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending',
        }),
      }),
    );
  });

  it('marks action executed with result payload', async () => {
    updateMock.mockResolvedValue({
      id: 'action-2',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedBy: 'admin-1',
      kind: 'server_memory_update',
      payloadJson: { operation: 'set' },
      status: 'executed',
      expiresAt: new Date('2026-02-26T12:10:00.000Z'),
      decidedBy: 'admin-2',
      decidedAt: new Date('2026-02-26T12:01:00.000Z'),
      executedAt: new Date('2026-02-26T12:01:10.000Z'),
      resultJson: { version: 2 },
      errorText: null,
      createdAt: new Date('2026-02-26T12:00:00.000Z'),
      updatedAt: new Date('2026-02-26T12:01:10.000Z'),
    });

    const { markPendingAdminActionExecuted } = await import('../../../src/core/admin/pendingAdminActionRepo');
    const result = await markPendingAdminActionExecuted({
      id: 'action-2',
      resultJson: { version: 2 },
    });

    expect(result.status).toBe('executed');
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'executed',
          resultJson: { version: 2 },
        }),
      }),
    );
  });
});
