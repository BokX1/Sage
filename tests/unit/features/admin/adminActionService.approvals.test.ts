import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPendingAdminAction: vi.fn(),
  attachPendingAdminActionRequestMessageId: vi.fn(),
  findMatchingPendingAdminAction: vi.fn(),
  getPendingAdminActionById: vi.fn(),
  clearPendingAdminActionApprovalMessageId: vi.fn(),
  markPendingAdminActionDecision: vi.fn(),
  markPendingAdminActionExecuted: vi.fn(),
  markPendingAdminActionExpired: vi.fn(),
  markPendingAdminActionFailed: vi.fn(),
  updatePendingAdminActionReviewSurface: vi.fn(),
  clearServerInstructions: vi.fn(),
  getServerInstructionsRecord: vi.fn(),
  upsertServerInstructions: vi.fn(),
  getGuildApprovalReviewChannelId: vi.fn(),
  setGuildApprovalReviewChannelId: vi.fn(),
  computeParamsHash: vi.fn(() => 'hash'),
  logAdminAction: vi.fn(),
  assertDiscordRestRequestGuildScoped: vi.fn(),
  discordRestRequestGuildScoped: vi.fn(),
  discordRestRequest: vi.fn(),
}));

vi.mock('@/features/admin/pendingAdminActionRepo', () => ({
  createPendingAdminAction: mocks.createPendingAdminAction,
  attachPendingAdminActionRequestMessageId: mocks.attachPendingAdminActionRequestMessageId,
  findMatchingPendingAdminAction: mocks.findMatchingPendingAdminAction,
  getPendingAdminActionById: mocks.getPendingAdminActionById,
  clearPendingAdminActionApprovalMessageId: mocks.clearPendingAdminActionApprovalMessageId,
  markPendingAdminActionDecision: mocks.markPendingAdminActionDecision,
  markPendingAdminActionExecuted: mocks.markPendingAdminActionExecuted,
  markPendingAdminActionExpired: mocks.markPendingAdminActionExpired,
  markPendingAdminActionFailed: mocks.markPendingAdminActionFailed,
  updatePendingAdminActionReviewSurface: mocks.updatePendingAdminActionReviewSurface,
}));

vi.mock('@/features/settings/guildSettingsRepo', () => ({
  getGuildApprovalReviewChannelId: mocks.getGuildApprovalReviewChannelId,
  setGuildApprovalReviewChannelId: mocks.setGuildApprovalReviewChannelId,
}));

vi.mock('@/features/settings/serverInstructionsRepo', () => ({
  clearServerInstructions: mocks.clearServerInstructions,
  getServerInstructionsRecord: mocks.getServerInstructionsRecord,
  upsertServerInstructions: mocks.upsertServerInstructions,
}));

vi.mock('@/features/relationships/adminAuditRepo', () => ({
  computeParamsHash: mocks.computeParamsHash,
  logAdminAction: mocks.logAdminAction,
}));

vi.mock('@/platform/discord/discordRestPolicy', () => ({
  assertDiscordRestRequestGuildScoped: mocks.assertDiscordRestRequestGuildScoped,
  discordRestRequestGuildScoped: mocks.discordRestRequestGuildScoped,
}));

vi.mock('@/platform/discord/discordRest', () => ({
  discordRestRequest: mocks.discordRestRequest,
}));

vi.mock('@/platform/discord/client', () => ({
  client: {},
}));

import {
  requestDiscordAdminActionForTool,
  requestDiscordRestWriteForTool,
  requestServerInstructionsUpdateForTool,
} from '@/features/admin/adminActionService';

describe('adminActionService approval coalescing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerInstructionsRecord.mockResolvedValue({
      instructionsText: 'Current instructions',
      version: 2,
    });
    mocks.getGuildApprovalReviewChannelId.mockResolvedValue(null);
    mocks.logAdminAction.mockResolvedValue(undefined);
    mocks.assertDiscordRestRequestGuildScoped.mockResolvedValue(undefined);
  });

  it('reuses an existing pending server-instructions action', async () => {
    mocks.findMatchingPendingAdminAction.mockResolvedValue({
      id: 'action-existing',
      guildId: 'guild-1',
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-9',
      approvalMessageId: 'approval-1',
      requestMessageId: null,
      requestedBy: 'admin-1',
      kind: 'server_instructions_update',
      payloadJson: {},
      status: 'pending',
      expiresAt: new Date('2026-03-10T10:10:00.000Z'),
      decidedBy: null,
      decidedAt: null,
      executedAt: null,
      resultJson: null,
      decisionReasonText: null,
      errorText: null,
      createdAt: new Date('2026-03-10T10:00:00.000Z'),
      updatedAt: new Date('2026-03-10T10:00:00.000Z'),
    });

    const result = await requestServerInstructionsUpdateForTool({
      guildId: 'guild-1',
      channelId: 'channel-2',
      requestedBy: 'admin-1',
      request: {
        operation: 'append',
        text: 'Add this note',
        reason: 'Keep docs aligned',
      },
    });

    expect(mocks.createPendingAdminAction).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'pending_approval',
      actionId: 'action-existing',
      approvalMessageId: 'approval-1',
      coalesced: true,
    });
  });

  it('reuses an existing pending moderation approval action', async () => {
    mocks.findMatchingPendingAdminAction.mockResolvedValue({
      id: 'action-mod',
      guildId: 'guild-1',
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-9',
      approvalMessageId: 'approval-mod',
      requestMessageId: null,
      requestedBy: 'admin-1',
      kind: 'discord_queue_moderation_action',
      payloadJson: {},
      status: 'pending',
      expiresAt: new Date('2026-03-10T10:10:00.000Z'),
      decidedBy: null,
      decidedAt: null,
      executedAt: null,
      resultJson: null,
      decisionReasonText: null,
      errorText: null,
      createdAt: new Date('2026-03-10T10:00:00.000Z'),
      updatedAt: new Date('2026-03-10T10:00:00.000Z'),
    });

    const result = await requestDiscordAdminActionForTool({
      guildId: 'guild-1',
      channelId: 'channel-2',
      requestedBy: 'admin-1',
      request: {
        action: 'delete_message',
        messageId: 'msg-1',
        reason: 'cleanup',
      },
    });

    expect(mocks.createPendingAdminAction).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'pending_approval',
      actionId: 'action-mod',
      approvalMessageId: 'approval-mod',
      action: 'delete_message',
      coalesced: true,
    });
  });

  it('reuses an existing pending Discord REST write approval action', async () => {
    mocks.findMatchingPendingAdminAction.mockResolvedValue({
      id: 'action-rest',
      guildId: 'guild-1',
      sourceChannelId: 'channel-1',
      reviewChannelId: 'channel-9',
      approvalMessageId: 'approval-rest',
      requestMessageId: null,
      requestedBy: 'admin-1',
      kind: 'discord_rest_write',
      payloadJson: {},
      status: 'pending',
      expiresAt: new Date('2026-03-10T10:10:00.000Z'),
      decidedBy: null,
      decidedAt: null,
      executedAt: null,
      resultJson: null,
      decisionReasonText: null,
      errorText: null,
      createdAt: new Date('2026-03-10T10:00:00.000Z'),
      updatedAt: new Date('2026-03-10T10:00:00.000Z'),
    });

    const result = await requestDiscordRestWriteForTool({
      guildId: 'guild-1',
      channelId: 'channel-2',
      requestedBy: 'admin-1',
      request: {
        method: 'PATCH',
        path: '/channels/1/messages/2',
        body: { content: 'Updated' },
      },
    });

    expect(mocks.createPendingAdminAction).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'pending_approval',
      actionId: 'action-rest',
      approvalMessageId: 'approval-rest',
      method: 'PATCH',
      path: '/channels/1/messages/2',
      coalesced: true,
    });
  });
});
