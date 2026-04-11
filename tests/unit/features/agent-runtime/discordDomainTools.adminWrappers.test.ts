import { PermissionsBitField } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '../../../../src/features/agent-runtime/toolRegistry';
import { config } from '../../../../src/platform/config/env';
import { ApprovalRequiredSignal } from '../../../../src/features/agent-runtime/toolControlSignals';

const mocks = vi.hoisted(() => ({
  requestDiscordAdminActionForTool: vi.fn(),
  requestDiscordRestWriteForTool: vi.fn(),
  requestDiscordRestWriteSequenceForTool: vi.fn(),
  requestDiscordInteractionForTool: vi.fn(),
  discordRestRequestGuildScoped: vi.fn(),
  guildFetch: vi.fn(),
  channelFetch: vi.fn(),
  getGuildApprovalReviewChannelId: vi.fn(),
  setGuildApprovalReviewChannelId: vi.fn(),
  getGuildArtifactVaultChannelId: vi.fn(),
  setGuildArtifactVaultChannelId: vi.fn(),
  getGuildModLogChannelId: vi.fn(),
  setGuildModLogChannelId: vi.fn(),
  listGuildChannelInvokePolicies: vi.fn(),
  upsertGuildChannelInvokePolicy: vi.fn(),
  deleteGuildChannelInvokePolicy: vi.fn(),
  getArtifactLatestTextContentForTool: vi.fn(),
  getPublicHostCodexAuthStatus: vi.fn(),
}));

vi.mock('../../../../src/features/admin/adminActionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/features/admin/adminActionService')>();
  return {
    ...actual,
    requestDiscordAdminActionForTool: mocks.requestDiscordAdminActionForTool,
    requestDiscordRestWriteForTool: mocks.requestDiscordRestWriteForTool,
    requestDiscordRestWriteSequenceForTool: mocks.requestDiscordRestWriteSequenceForTool,
    requestDiscordInteractionForTool: mocks.requestDiscordInteractionForTool,
  };
});

vi.mock('../../../../src/platform/discord/discordRestPolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/platform/discord/discordRestPolicy')>();
  return {
    ...actual,
    discordRestRequestGuildScoped: mocks.discordRestRequestGuildScoped,
  };
});

vi.mock('../../../../src/platform/discord/client', () => ({
  client: {
    channels: {
      fetch: mocks.channelFetch,
    },
    guilds: {
      fetch: mocks.guildFetch,
    },
  },
}));

vi.mock('../../../../src/features/settings/guildSettingsRepo', () => ({
  getGuildApprovalReviewChannelId: mocks.getGuildApprovalReviewChannelId,
  setGuildApprovalReviewChannelId: mocks.setGuildApprovalReviewChannelId,
  getGuildArtifactVaultChannelId: mocks.getGuildArtifactVaultChannelId,
  setGuildArtifactVaultChannelId: mocks.setGuildArtifactVaultChannelId,
  getGuildModLogChannelId: mocks.getGuildModLogChannelId,
  setGuildModLogChannelId: mocks.setGuildModLogChannelId,
}));

vi.mock('../../../../src/features/settings/guildChannelInvokePolicyRepo', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../../src/features/settings/guildChannelInvokePolicyRepo')
  >();
  return {
    ...actual,
    listGuildChannelInvokePolicies: mocks.listGuildChannelInvokePolicies,
    upsertGuildChannelInvokePolicy: mocks.upsertGuildChannelInvokePolicy,
    deleteGuildChannelInvokePolicy: mocks.deleteGuildChannelInvokePolicy,
  };
});

vi.mock('../../../../src/features/artifacts/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/features/artifacts/service')>();
  return {
    ...actual,
    getArtifactLatestTextContentForTool: mocks.getArtifactLatestTextContentForTool,
  };
});

vi.mock('../../../../src/features/auth/hostCodexAuthService', () => ({
  getPublicHostCodexAuthStatus: mocks.getPublicHostCodexAuthStatus,
}));

import { discordTools } from '../../../../src/features/agent-runtime/discordDomainTools';

function tool(name: string) {
  const found = discordTools.find((entry) => entry.name === name);
  if (!found) {
    throw new Error(`Expected Discord tool ${name} to exist.`);
  }
  return found;
}

describe('discord admin granular wrappers', () => {
  const removedRawDiscordApiToolName = ['discord', 'admin', 'api'].join('_');
  const adminCtx: ToolExecutionContext = {
    traceId: 'trace',
    userId: 'user-1',
    channelId: 'channel-1',
    guildId: 'guild-1',
    invokedBy: 'mention',
    invokerIsAdmin: true,
    invokerAuthority: 'admin',
  };

  beforeEach(() => {
    mocks.requestDiscordAdminActionForTool.mockReset().mockResolvedValue({
      ok: true,
      requestId: 'approval-1',
    });
    mocks.requestDiscordRestWriteForTool.mockReset().mockRejectedValue(
      new ApprovalRequiredSignal({
        kind: 'discord_rest_write',
        guildId: 'guild-1',
        sourceChannelId: 'channel-1',
        reviewChannelId: 'channel-1',
        requestedBy: 'user-1',
        dedupeKey: 'dedupe-1',
        executionPayloadJson: {},
        reviewSnapshotJson: {},
      }),
    );
    mocks.requestDiscordRestWriteSequenceForTool.mockReset().mockRejectedValue(
      new ApprovalRequiredSignal({
        kind: 'discord_rest_write',
        guildId: 'guild-1',
        sourceChannelId: 'channel-1',
        reviewChannelId: 'channel-1',
        requestedBy: 'user-1',
        dedupeKey: 'dedupe-seq-1',
        executionPayloadJson: {},
        reviewSnapshotJson: {},
      }),
    );
    mocks.requestDiscordInteractionForTool.mockReset().mockResolvedValue({
      status: 'executed',
      action: 'send_message',
      channelId: 'channel-1',
      messageId: 'message-1',
    });
    mocks.discordRestRequestGuildScoped.mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'message-1' },
    });
    mocks.guildFetch.mockReset();
    mocks.channelFetch.mockReset().mockResolvedValue({
      id: 'channel-2',
      guildId: 'guild-1',
      type: 0,
      isDMBased: () => false,
      isTextBased: () => true,
      permissionsFor: vi.fn(
        () =>
          new PermissionsBitField(
            PermissionsBitField.Flags.CreatePublicThreads |
              PermissionsBitField.Flags.SendMessagesInThreads,
          ),
      ),
    });
    mocks.getGuildApprovalReviewChannelId.mockReset().mockResolvedValue(null);
    mocks.setGuildApprovalReviewChannelId.mockReset().mockResolvedValue(undefined);
    mocks.getGuildArtifactVaultChannelId.mockReset().mockResolvedValue(null);
    mocks.setGuildArtifactVaultChannelId.mockReset().mockResolvedValue(undefined);
    mocks.getGuildModLogChannelId.mockReset().mockResolvedValue(null);
    mocks.setGuildModLogChannelId.mockReset().mockResolvedValue(undefined);
    mocks.listGuildChannelInvokePolicies.mockReset().mockResolvedValue([]);
    mocks.upsertGuildChannelInvokePolicy.mockReset().mockResolvedValue({
      guildId: 'guild-1',
      channelId: 'channel-2',
      mode: 'public_from_message',
      autoArchiveDurationMinutes: null,
    });
    mocks.deleteGuildChannelInvokePolicy.mockReset().mockResolvedValue(undefined);
    mocks.getArtifactLatestTextContentForTool.mockReset().mockResolvedValue({
      artifactId: 'artifact-1',
      name: 'Release Notes',
      filename: 'release-notes.md',
      revisionId: 'revision-1',
      revisionNumber: 2,
      contentText: 'Artifact body',
    });
    mocks.getPublicHostCodexAuthStatus.mockReset().mockResolvedValue({
      configured: true,
      provider: 'openai_codex',
      status: 'active',
      expiresAt: '2026-03-24T12:00:00.000Z',
      activeTextProvider: 'openai_codex',
      fallbackTextProviderConfigured: true,
      hasOperatorError: false,
    });
  });

  it('queues edit_message as an approval-gated REST write', async () => {
    await expect(
      tool('discord_spaces_edit_message').execute(
        {
          messageId: 'msg-1',
          content: 'Updated',
        },
        adminCtx,
      ),
    ).rejects.toBeInstanceOf(ApprovalRequiredSignal);

    expect(mocks.requestDiscordRestWriteForTool).toHaveBeenCalledWith({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedBy: 'user-1',
      sourceMessageId: null,
      request: {
        method: 'PATCH',
        path: '/channels/channel-1/messages/msg-1',
        body: {
          content: 'Updated',
          allowed_mentions: { parse: [] },
        },
        reason: undefined,
      },
    });
  });

  it('queues create_channel and strips text-only fields for voice channels', async () => {
    await expect(
      tool('discord_spaces_create_channel').execute(
        {
          name: 'Voice Lounge',
          type: 'voice',
          topic: 'ignore me',
          rateLimitPerUser: 10,
        },
        adminCtx,
      ),
    ).rejects.toBeInstanceOf(ApprovalRequiredSignal);

    const call = mocks.requestDiscordRestWriteForTool.mock.calls[0]?.[0] as {
      request: { body?: Record<string, unknown> };
    };
    expect(call.request.body).toEqual(
      expect.objectContaining({
        name: 'Voice Lounge',
        type: 2,
      }),
    );
    expect(call.request.body?.topic).toBeUndefined();
    expect(call.request.body?.rate_limit_per_user).toBeUndefined();
  });

  it('queues create_role and converts colorHex to Discord integer color', async () => {
    await expect(
      tool('discord_spaces_create_role').execute(
        {
          name: 'Moderators',
          colorHex: '#ff0000',
          permissions: '8',
        },
        adminCtx,
      ),
    ).rejects.toBeInstanceOf(ApprovalRequiredSignal);

    const call = mocks.requestDiscordRestWriteForTool.mock.calls[0]?.[0] as {
      request: { method: string; path: string; body?: Record<string, unknown> };
    };
    expect(call.request.method).toBe('POST');
    expect(call.request.path).toBe('/guilds/guild-1/roles');
    expect(call.request.body).toEqual(
      expect.objectContaining({
        name: 'Moderators',
        color: 0xff0000,
        permissions: '8',
      }),
    );
  });

  it('generates an OAuth2 invite URL using the configured app id', async () => {
    const result = await tool('discord_spaces_get_invite_url').execute({}, {
      traceId: 'trace',
      userId: 'user-1',
      channelId: 'channel-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'get_invite_url',
        url: expect.any(String),
      }),
    );
    const url = new URL((result as { url: string }).url);
    expect(url.searchParams.get('client_id')).toBe(config.DISCORD_APP_ID.trim());
    expect(url.searchParams.get('scope')).toBe('bot');
    expect(url.searchParams.get('permissions')).toBe('0');
  });

  it('returns host auth status for admin operators', async () => {
    const result = await tool('discord_governance_get_host_auth_status').execute({}, adminCtx);

    expect(mocks.getPublicHostCodexAuthStatus).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'get_host_auth_status',
        status: expect.objectContaining({
          configured: true,
          activeTextProvider: 'openai_codex',
        }),
      }),
    );
  });

  it('posts a host auth status card for admins', async () => {
    const result = await tool('discord_governance_send_host_auth_status_card').execute({}, adminCtx);

    expect(mocks.discordRestRequestGuildScoped).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        method: 'POST',
        path: '/channels/channel-1/messages',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'send_host_auth_status_card',
        channelId: 'channel-1',
      }),
    );
  });

  it('allows moderator-only submit_moderation when the requester has Manage Messages in the target channel', async () => {
    const targetChannelId = '123456789012345678';
    const requester = {
      permissions: new PermissionsBitField(0n),
      permissionsIn: vi.fn(
        () => new PermissionsBitField(PermissionsBitField.Flags.ManageMessages),
      ),
    };
    mocks.guildFetch.mockResolvedValue({
      members: { fetch: vi.fn().mockResolvedValue(requester) },
      channels: { fetch: vi.fn().mockResolvedValue({ id: targetChannelId }) },
    });

    const result = await tool('discord_moderation_submit_action').execute(
      {
        request: {
          action: 'bulk_delete_messages',
          channelId: targetChannelId,
          messageIds: ['223456789012345678', '323456789012345678'],
          reason: 'Raid cleanup',
        },
      },
      {
        traceId: 'trace',
        userId: 'user-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        invokedBy: 'mention',
        invokerIsAdmin: false,
        invokerCanModerate: true,
      },
    );

    expect(result).toEqual({ ok: true, requestId: 'approval-1' });
    expect(mocks.requestDiscordAdminActionForTool).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-1',
        requestedBy: 'user-1',
        sourceMessageId: null,
        request: expect.objectContaining({
          action: 'bulk_delete_messages',
          channelId: targetChannelId,
        }),
      }),
    );
  });

  it('keeps non-moderation admin actions blocked for moderator-only turns', async () => {
    await expect(
      tool('discord_governance_clear_server_api_key').execute(
        {},
        {
          traceId: 'trace',
          userId: 'user-1',
          channelId: 'channel-1',
          guildId: 'guild-1',
          invokedBy: 'mention',
          invokerIsAdmin: false,
          invokerCanModerate: true,
        },
      ),
    ).rejects.toThrow(/owner/i);
    expect(mocks.requestDiscordAdminActionForTool).not.toHaveBeenCalled();
  });

  it('configures and reports artifact vault routing through governance tools', async () => {
    await tool('discord_governance_set_artifact_vault_channel').execute(
      {
        channelId: 'channel-2',
      },
      adminCtx,
    );

    expect(mocks.setGuildArtifactVaultChannelId).toHaveBeenCalledWith('guild-1', 'channel-2');

    mocks.getGuildArtifactVaultChannelId.mockResolvedValue('channel-2');
    const status = await tool('discord_governance_get_artifact_vault_status').execute({}, adminCtx);

    expect(status).toEqual(
      expect.objectContaining({
        ok: true,
        artifactVaultChannelId: 'channel-2',
        routingMode: 'dedicated_artifact_vault',
      }),
    );
  });

  it('configures and clears the default moderation log routing', async () => {
    await tool('discord_governance_set_mod_log_channel').execute(
      {
        channelId: 'channel-2',
      },
      adminCtx,
    );

    expect(mocks.setGuildModLogChannelId).toHaveBeenCalledWith('guild-1', 'channel-2');

    await tool('discord_governance_clear_mod_log_channel').execute({}, adminCtx);

    expect(mocks.setGuildModLogChannelId).toHaveBeenLastCalledWith('guild-1', null);
  });

  it('reports invoke-thread channel permission health in governance status', async () => {
    mocks.listGuildChannelInvokePolicies.mockResolvedValueOnce([
      {
        guildId: 'guild-1',
        channelId: 'channel-2',
        mode: 'public_from_message',
        autoArchiveDurationMinutes: null,
      },
    ]);

    mocks.channelFetch.mockResolvedValueOnce({
      id: 'channel-2',
      guildId: 'guild-1',
      type: 0,
      isDMBased: () => false,
      isTextBased: () => true,
      permissionsFor: vi.fn(() => new PermissionsBitField(0n)),
    });

    const status = await tool('discord_governance_get_invoke_thread_status').execute({}, adminCtx);

    expect(status).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'get_invoke_thread_status',
        items: [
          expect.objectContaining({
            channelId: 'channel-2',
            supportsMode: true,
            threadRoutingHealthy: false,
            missingBotPermissions: ['CreatePublicThreads', 'SendMessagesInThreads'],
          }),
        ],
      }),
    );
  });

  it('rejects enabling invoke-thread routing when Sage lacks required thread permissions', async () => {
    mocks.channelFetch.mockResolvedValueOnce({
      id: 'channel-2',
      guildId: 'guild-1',
      type: 0,
      isDMBased: () => false,
      isTextBased: () => true,
      permissionsFor: vi.fn(() => new PermissionsBitField(0n)),
    });

    await expect(
      tool('discord_governance_enable_invoke_thread_channel').execute(
        {
          channelId: 'channel-2',
        },
        adminCtx,
      ),
    ).rejects.toThrow(/CreatePublicThreads, SendMessagesInThreads/i);
  });

  it('builds forum posts from artifact content when artifactId is provided', async () => {
    await expect(
      tool('discord_spaces_create_forum_post').execute(
        {
          forumChannelId: 'forum-1',
          artifactId: 'artifact-1',
        },
        adminCtx,
      ),
    ).rejects.toBeInstanceOf(ApprovalRequiredSignal);

    expect(mocks.getArtifactLatestTextContentForTool).toHaveBeenCalledWith({
      guildId: 'guild-1',
      requesterUserId: 'user-1',
      artifactId: 'artifact-1',
    });
    expect(mocks.requestDiscordRestWriteForTool).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          path: '/channels/forum-1/threads',
          body: expect.objectContaining({
            name: 'Release Notes',
            message: expect.objectContaining({
              content: 'Artifact body',
            }),
          }),
        }),
      }),
    );
  });

  it('rejects artifact-backed forum posts when the starter content exceeds Discord limits', async () => {
    mocks.getArtifactLatestTextContentForTool.mockResolvedValueOnce({
      artifactId: 'artifact-1',
      name: 'Release Notes',
      filename: 'release-notes.md',
      revisionId: 'revision-1',
      revisionNumber: 2,
      contentText: 'A'.repeat(2_001),
    });

    await expect(
      tool('discord_spaces_create_forum_post').execute(
        {
          forumChannelId: 'forum-1',
          artifactId: 'artifact-1',
        },
        adminCtx,
      ),
    ).rejects.toThrow('Forum post starter content exceeds Discord limits.');
    expect(mocks.requestDiscordRestWriteForTool).not.toHaveBeenCalled();
  });

  it('queues resolution notes and thread state changes under one approval-gated REST sequence', async () => {
    await expect(
      tool('discord_spaces_archive_thread').execute(
        {
          threadId: 'thread-1',
          resolutionNoteText: 'Resolved after confirming the fix.',
        },
        adminCtx,
      ),
    ).rejects.toBeInstanceOf(ApprovalRequiredSignal);

    expect(mocks.requestDiscordRestWriteSequenceForTool).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-1',
        requestedBy: 'user-1',
        requests: [
          expect.objectContaining({
            method: 'POST',
            path: '/channels/thread-1/messages',
            body: expect.objectContaining({
              content: 'Resolved after confirming the fix.',
            }),
          }),
          expect.objectContaining({
            method: 'PATCH',
            path: '/channels/thread-1',
            body: expect.objectContaining({
              archived: true,
            }),
          }),
        ],
      }),
    );
  });

  it('removes the raw Discord API fallback from the model-facing tool surface', () => {
    const names = discordTools.map((entry) => entry.name);

    expect(names).not.toContain(removedRawDiscordApiToolName);
    expect(names).toContain('discord_governance_get_server_instructions');
    expect(names).toContain('discord_moderation_submit_action');
  });
});
