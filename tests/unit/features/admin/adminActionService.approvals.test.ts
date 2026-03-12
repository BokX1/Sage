import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const allowAllPermissions = {
    has: vi.fn(() => true),
  };

  const botMember = {
    permissions: allowAllPermissions,
    permissionsIn: vi.fn(() => allowAllPermissions),
    roles: {
      highest: {
        comparePositionTo: vi.fn(() => 1),
      },
    },
  };

  const targetMember = {
    id: 'user-8',
    guild: { ownerId: 'owner-1' },
    roles: {
      highest: {
        position: 1,
      },
    },
    communicationDisabledUntilTimestamp: Date.now() + 60_000,
  };

  const message = {
    id: 'msg-1',
    channelId: 'chan-9',
    guildId: 'guild-1',
    content: 'buy cheap spam now',
    author: {
      id: 'user-8',
      username: 'spammer',
      globalName: 'Spammer',
      bot: false,
    },
    member: {
      displayName: 'Spammer',
    },
    reactions: {
      resolve: vi.fn(() => null),
      fetch: vi.fn(async () => null),
      cache: new Map(),
      removeAll: vi.fn(async () => undefined),
    },
    delete: vi.fn(async () => undefined),
    react: vi.fn(async () => undefined),
    startThread: vi.fn(async () => ({ id: 'thread-1' })),
  };

  const channel = {
    id: 'chan-9',
    guildId: 'guild-1',
    isDMBased: vi.fn(() => false),
    send: vi.fn(async () => ({ id: 'sent-1' })),
    messages: {
      fetch: vi.fn(async () => message),
    },
  };

  const guild = {
    id: 'guild-1',
    members: {
      me: botMember,
      fetchMe: vi.fn(async () => botMember),
      fetch: vi.fn(async () => targetMember),
    },
    bans: {
      fetch: vi.fn(async () => ({ user: { id: 'user-8' } })),
    },
  };

  return {
    clearGuildSagePersona: vi.fn(),
    getGuildSagePersonaRecord: vi.fn(),
    upsertGuildSagePersona: vi.fn(),
    getGuildApprovalReviewChannelId: vi.fn(),
    computeParamsHash: vi.fn(() => 'hash'),
    logAdminAction: vi.fn(),
    assertDiscordRestRequestGuildScoped: vi.fn(),
    discordRestRequestGuildScoped: vi.fn(),
    discordRestRequest: vi.fn(),
    client: {
      guilds: {
        fetch: vi.fn(async () => guild),
      },
      channels: {
        fetch: vi.fn(async () => channel),
      },
    },
  };
});

vi.mock('@/features/settings/guildSettingsRepo', () => ({
  getGuildApprovalReviewChannelId: mocks.getGuildApprovalReviewChannelId,
}));

vi.mock('@/features/settings/guildSagePersonaRepo', () => ({
  clearGuildSagePersona: mocks.clearGuildSagePersona,
  getGuildSagePersonaRecord: mocks.getGuildSagePersonaRecord,
  upsertGuildSagePersona: mocks.upsertGuildSagePersona,
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
  client: mocks.client,
}));

import {
  requestDiscordAdminActionForTool,
  requestDiscordRestWriteForTool,
  requestSagePersonaUpdateForTool,
} from '@/features/admin/adminActionService';
import { ApprovalRequiredSignal } from '@/features/agent-runtime/toolControlSignals';

async function expectApprovalSignal(promise: Promise<never>): Promise<ApprovalRequiredSignal> {
  try {
    await promise;
    throw new Error('Expected ApprovalRequiredSignal');
  } catch (error) {
    expect(error).toBeInstanceOf(ApprovalRequiredSignal);
    return error as ApprovalRequiredSignal;
  }
}

describe('adminActionService approval signal shaping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGuildSagePersonaRecord.mockResolvedValue({
      instructionsText: 'Current Sage Persona',
      version: 2,
    });
    mocks.getGuildApprovalReviewChannelId.mockResolvedValue(null);
    mocks.logAdminAction.mockResolvedValue(undefined);
    mocks.assertDiscordRestRequestGuildScoped.mockResolvedValue(undefined);
  });

  it('throws an approval signal for Sage Persona updates', async () => {
    const signal = await expectApprovalSignal(
      requestSagePersonaUpdateForTool({
        guildId: 'guild-1',
        channelId: 'channel-2',
        requestedBy: 'admin-1',
        request: {
          operation: 'append',
          text: 'Add this note',
          reason: 'Keep docs aligned',
        },
      }),
    );

    expect(signal.payload).toMatchObject({
      kind: 'server_instructions_update',
      guildId: 'guild-1',
      sourceChannelId: 'channel-2',
      reviewChannelId: 'channel-2',
      requestedBy: 'admin-1',
      executionPayloadJson: {
        operation: 'append',
        newInstructionsText: 'Current Sage Persona\nAdd this note',
        reason: 'Keep docs aligned',
        baseVersion: 2,
      },
      reviewSnapshotJson: {
        operation: 'append',
        baseVersion: 2,
      },
    });
    expect(signal.payload.dedupeKey).toBe('hash');
  });

  it('throws an approval signal for moderation requests', async () => {
    const signal = await expectApprovalSignal(
      requestDiscordAdminActionForTool({
        guildId: 'guild-1',
        channelId: 'channel-source',
        requestedBy: 'admin-1',
        request: {
          action: 'delete_message',
          reason: 'Spam cleanup',
        },
        replyTarget: {
          messageId: 'msg-1',
          guildId: 'guild-1',
          channelId: 'chan-9',
          authorId: 'user-8',
          authorDisplayName: 'Spammer',
          authorIsBot: false,
          replyToMessageId: null,
          mentionedUserIds: [],
          content: 'buy cheap spam now',
        },
      }),
    );

    expect(signal.payload).toMatchObject({
      kind: 'discord_queue_moderation_action',
      guildId: 'guild-1',
      sourceChannelId: 'channel-source',
      reviewChannelId: 'channel-source',
      requestedBy: 'admin-1',
      reviewSnapshotJson: {
        action: 'delete_message',
      },
    });
    expect(signal.payload.dedupeKey).toContain('delete_message');
  });

  it('normalizes bulk-delete moderation targets so equivalent requests share the same dedupe key', async () => {
    const firstSignal = await expectApprovalSignal(
      requestDiscordAdminActionForTool({
        guildId: 'guild-1',
        channelId: 'channel-source',
        requestedBy: 'admin-1',
        request: {
          action: 'bulk_delete_messages',
          channelId: 'chan-9',
          messageIds: ['3003', '2002'],
          reason: 'Raid cleanup',
        },
      }),
    );

    const secondSignal = await expectApprovalSignal(
      requestDiscordAdminActionForTool({
        guildId: 'guild-1',
        channelId: 'channel-source',
        requestedBy: 'admin-1',
        request: {
          action: 'bulk_delete_messages',
          channelId: 'chan-9',
          messageIds: ['2002', '3003'],
          reason: 'Raid cleanup',
        },
      }),
    );

    expect(firstSignal.payload.dedupeKey).toBe(secondSignal.payload.dedupeKey);
    expect(firstSignal.payload.reviewSnapshotJson).toEqual(
      expect.objectContaining({
        action: 'bulk_delete_messages',
      }),
    );
  });

  it('throws an approval signal for Discord REST writes', async () => {
    const signal = await expectApprovalSignal(
      requestDiscordRestWriteForTool({
        guildId: 'guild-1',
        channelId: 'channel-2',
        requestedBy: 'admin-1',
        request: {
          method: 'PATCH',
          path: '/channels/1/messages/2',
          body: { content: 'Updated' },
        },
      }),
    );

    expect(signal.payload).toMatchObject({
      kind: 'discord_rest_write',
      guildId: 'guild-1',
      sourceChannelId: 'channel-2',
      reviewChannelId: 'channel-2',
      requestedBy: 'admin-1',
      executionPayloadJson: {
        request: {
          method: 'PATCH',
          path: '/channels/1/messages/2',
          body: { content: 'Updated' },
        },
      },
      reviewSnapshotJson: {
        method: 'PATCH',
        path: '/channels/1/messages/2',
      },
    });
    expect(signal.payload.dedupeKey).toBe('hash');
  });
});
