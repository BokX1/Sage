import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.hoisted(() => vi.fn());
const findUniqueMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());

vi.mock('@/platform/db/prisma-client', () => ({
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
      approvalMessageId: null,
      requestMessageId: null,
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

    const { createPendingAdminAction } = await import('../../../../src/features/admin/pendingAdminActionRepo');
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
      approvalMessageId: null,
      requestMessageId: null,
      requestedBy: 'admin-1',
      kind: 'server_instructions_update',
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

    const { markPendingAdminActionExecuted } = await import('../../../../src/features/admin/pendingAdminActionRepo');
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

  it('attaches a requester message id to an action', async () => {
    updateMock.mockResolvedValue({
      id: 'action-3',
      guildId: 'guild-1',
      channelId: 'channel-1',
      approvalMessageId: null,
      requestMessageId: 'msg-123',
      requestedBy: 'admin-1',
      kind: 'discord_rest_write',
      payloadJson: { request: { method: 'PATCH', path: '/channels/1/messages/2' } },
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

    const { attachPendingAdminActionRequestMessageId } = await import('../../../../src/features/admin/pendingAdminActionRepo');
    const result = await attachPendingAdminActionRequestMessageId({
      id: 'action-3',
      requestMessageId: 'msg-123',
    });

    expect(result.requestMessageId).toBe('msg-123');
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'action-3' },
        data: { requestMessageId: 'msg-123' },
      }),
    );
  });

  it('attaches an approval message id to an action', async () => {
    updateMock.mockResolvedValue({
      id: 'action-4',
      guildId: 'guild-1',
      channelId: 'channel-1',
      approvalMessageId: 'approval-456',
      requestMessageId: null,
      requestedBy: 'admin-1',
      kind: 'discord_queue_moderation_action',
      payloadJson: { action: { action: 'delete_message', messageId: 'msg-1', reason: 'cleanup' } },
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

    const { attachPendingAdminActionApprovalMessageId } = await import('../../../../src/features/admin/pendingAdminActionRepo');
    const result = await attachPendingAdminActionApprovalMessageId({
      id: 'action-4',
      approvalMessageId: 'approval-456',
    });

    expect(result.approvalMessageId).toBe('approval-456');
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'action-4' },
        data: { approvalMessageId: 'approval-456' },
      }),
    );
  });
});
