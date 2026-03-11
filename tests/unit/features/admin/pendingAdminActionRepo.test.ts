import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.hoisted(() => vi.fn());
const findUniqueMock = vi.hoisted(() => vi.fn());
const findManyMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const updateManyMock = vi.hoisted(() => vi.fn());

vi.mock('@/platform/db/prisma-client', () => ({
  prisma: {
    pendingAdminAction: {
      create: createMock,
      findMany: findManyMock,
      findUnique: findUniqueMock,
      update: updateMock,
      updateMany: updateManyMock,
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
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-review',
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
      decisionReasonText: null,
      errorText: null,
      createdAt: new Date('2026-02-26T12:00:00.000Z'),
      updatedAt: new Date('2026-02-26T12:00:00.000Z'),
    });

    const { createPendingAdminAction } = await import('../../../../src/features/admin/pendingAdminActionRepo');
    const result = await createPendingAdminAction({
      guildId: 'guild-1',
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-review',
      requestedBy: 'admin-1',
      kind: 'discord_queue_moderation_action',
      payloadJson: { action: 'delete_message' },
      expiresAt: new Date('2026-02-26T12:10:00.000Z'),
    });

    expect(result.status).toBe('pending');
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceChannelId: 'channel-1',
          reviewChannelId: 'channel-review',
          status: 'pending',
        }),
      }),
    );
  });

  it('marks action executed with result payload', async () => {
    updateMock.mockResolvedValue({
      id: 'action-2',
      guildId: 'guild-1',
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-review',
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
      decisionReasonText: null,
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
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-review',
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
      decisionReasonText: null,
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
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-review',
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
      decisionReasonText: null,
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

  it('finds a matching unresolved pending action using normalized payload comparison', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'action-5',
        guildId: 'guild-1',
        sourceChannelId: 'channel-1',
        reviewChannelId: 'channel-review',
        approvalMessageId: 'approval-1',
        requestMessageId: null,
        requestedBy: 'admin-1',
        kind: 'discord_rest_write',
        payloadJson: {
          request: {
            path: '/channels/1/messages/2',
            method: 'PATCH',
            body: {
              nested: { b: 2, a: 1 },
            },
          },
        },
        status: 'pending',
        expiresAt: new Date('2026-02-26T12:10:00.000Z'),
        decidedBy: null,
        decidedAt: null,
        executedAt: null,
        resultJson: null,
        decisionReasonText: null,
        errorText: null,
        createdAt: new Date('2026-02-26T12:00:00.000Z'),
        updatedAt: new Date('2026-02-26T12:00:00.000Z'),
      },
    ]);

    const { findMatchingPendingAdminAction } = await import('../../../../src/features/admin/pendingAdminActionRepo');
    const result = await findMatchingPendingAdminAction({
      guildId: 'guild-1',
      requestedBy: 'admin-1',
      kind: 'discord_rest_write',
      payloadJson: {
        request: {
          method: 'PATCH',
          path: '/channels/1/messages/2',
          body: {
            nested: { a: 1, b: 2 },
          },
        },
      },
      now: new Date('2026-02-26T12:01:00.000Z'),
    });

    expect(result?.id).toBe('action-5');
    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        guildId: 'guild-1',
        requestedBy: 'admin-1',
        kind: 'discord_rest_write',
        status: 'pending',
        expiresAt: { gt: new Date('2026-02-26T12:01:00.000Z') },
      },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('returns null when only expired or non-matching pending actions exist', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'action-6',
        guildId: 'guild-1',
        sourceChannelId: 'channel-1',
        reviewChannelId: 'channel-review',
        approvalMessageId: null,
        requestMessageId: null,
        requestedBy: 'admin-1',
        kind: 'server_instructions_update',
        payloadJson: { operation: 'set', newInstructionsText: 'Old', reason: 'test', baseVersion: 1 },
        status: 'pending',
        expiresAt: new Date('2026-02-26T12:10:00.000Z'),
        decidedBy: null,
        decidedAt: null,
        executedAt: null,
        resultJson: null,
        decisionReasonText: null,
        errorText: null,
        createdAt: new Date('2026-02-26T12:00:00.000Z'),
        updatedAt: new Date('2026-02-26T12:00:00.000Z'),
      },
    ]);

    const { findMatchingPendingAdminAction } = await import('../../../../src/features/admin/pendingAdminActionRepo');
    const result = await findMatchingPendingAdminAction({
      guildId: 'guild-1',
      requestedBy: 'admin-1',
      kind: 'server_instructions_update',
      payloadJson: { operation: 'set', newInstructionsText: 'New', reason: 'test', baseVersion: 1 },
      now: new Date('2026-02-26T12:01:00.000Z'),
    });

    expect(result).toBeNull();
  });

  it('matches prepared moderation payloads against legacy pending actions via canonical moderation dedupe', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'action-7',
        guildId: 'guild-1',
        sourceChannelId: 'channel-1',
        reviewChannelId: 'channel-review',
        approvalMessageId: null,
        requestMessageId: null,
        requestedBy: 'admin-1',
        kind: 'discord_queue_moderation_action',
        payloadJson: {
          action: {
            action: 'delete_message',
            channelId: 'channel-1',
            messageId: 'msg-1',
            reason: 'cleanup',
          },
        },
        status: 'pending',
        expiresAt: new Date('2026-02-26T12:10:00.000Z'),
        decidedBy: null,
        decidedAt: null,
        executedAt: null,
        resultJson: null,
        decisionReasonText: null,
        errorText: null,
        createdAt: new Date('2026-02-26T12:00:00.000Z'),
        updatedAt: new Date('2026-02-26T12:00:00.000Z'),
      },
    ]);

    const { findMatchingPendingAdminAction } = await import('../../../../src/features/admin/pendingAdminActionRepo');
    const result = await findMatchingPendingAdminAction({
      guildId: 'guild-1',
      requestedBy: 'admin-1',
      kind: 'discord_queue_moderation_action',
      payloadJson: {
        prepared: {
          version: 1,
          originalRequest: {
            action: 'delete_message',
            channelId: 'channel-1',
            messageId: 'https://discord.com/channels/guild-1/channel-1/msg-1',
            reason: 'cleanup',
          },
          canonicalAction: {
            action: 'delete_message',
            channelId: 'channel-1',
            messageId: 'msg-1',
            reason: 'cleanup',
          },
          evidence: {
            targetKind: 'message',
            source: 'message_url',
            channelId: 'channel-1',
            messageId: 'msg-1',
            messageUrl: 'https://discord.com/channels/guild-1/channel-1/msg-1',
            userId: 'user-1',
            messageAuthorId: 'user-1',
            messageAuthorDisplayName: 'User One',
            messageExcerpt: 'spam message',
          },
          preflight: {
            approverPermission: 'Manage Messages',
            botPermissionChecks: ['Manage Messages'],
            targetChannelScope: 'channel-1',
            hierarchyChecked: false,
            notes: ['Resolved from a Discord message URL.'],
          },
          dedupeKey: JSON.stringify({
            action: 'delete_message',
            channelId: 'channel-1',
            messageId: 'msg-1',
            reason: 'cleanup',
          }),
        },
      },
      now: new Date('2026-02-26T12:01:00.000Z'),
    });

    expect(result?.id).toBe('action-7');
  });

  it('claims a pending decision atomically when the row is still pending', async () => {
    updateManyMock.mockResolvedValue({ count: 1 });
    findUniqueMock.mockResolvedValue({
      id: 'action-8',
      guildId: 'guild-1',
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-review',
      approvalMessageId: null,
      requestMessageId: null,
      requestedBy: 'admin-1',
      kind: 'discord_queue_moderation_action',
      payloadJson: {},
      status: 'approved',
      expiresAt: new Date('2026-02-26T12:10:00.000Z'),
      decidedBy: 'admin-2',
      decidedAt: new Date('2026-02-26T12:01:00.000Z'),
      executedAt: null,
      resultJson: null,
      decisionReasonText: null,
      errorText: null,
      createdAt: new Date('2026-02-26T12:00:00.000Z'),
      updatedAt: new Date('2026-02-26T12:01:00.000Z'),
    });

    const { markPendingAdminActionDecisionIfPending } = await import('../../../../src/features/admin/pendingAdminActionRepo');
    const result = await markPendingAdminActionDecisionIfPending({
      id: 'action-8',
      decidedBy: 'admin-2',
      status: 'approved',
    });

    expect(result?.status).toBe('approved');
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'action-8',
          status: 'pending',
        }),
      }),
    );
  });

  it('returns null when an atomic decision claim loses the race', async () => {
    updateManyMock.mockResolvedValue({ count: 0 });

    const { markPendingAdminActionDecisionIfPending } = await import('../../../../src/features/admin/pendingAdminActionRepo');
    const result = await markPendingAdminActionDecisionIfPending({
      id: 'action-9',
      decidedBy: 'admin-2',
      status: 'approved',
    });

    expect(result).toBeNull();
  });
});
