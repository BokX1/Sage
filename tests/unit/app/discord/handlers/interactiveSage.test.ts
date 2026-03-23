import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const generateChatReplyMock = vi.hoisted(() => vi.fn());
const retryFailedChatTurnMock = vi.hoisted(() => vi.fn());
const parseInteractiveSessionCustomIdMock = vi.hoisted(() => vi.fn());
const getActiveInteractiveSessionMock = vi.hoisted(() => vi.fn());
const consumeActiveInteractiveSessionMock = vi.hoisted(() => vi.fn());
const createInteractiveButtonSessionMock = vi.hoisted(() => vi.fn(async () => 'sage:ui:continue-1'));
const isAdminFromMemberMock = vi.hoisted(() => vi.fn(() => true));
const isModeratorFromMemberMock = vi.hoisted(() => vi.fn(() => true));
const resolveAuthorityTierFromMemberMock = vi.hoisted(() => vi.fn(() => 'admin'));
const buildGuildApiKeyMissingResponseMock = vi.hoisted(() =>
  vi.fn(() => ({
    flags: 32768,
    components: [],
  })),
);

vi.mock('@/features/chat/chat-engine', () => ({
  generateChatReply: generateChatReplyMock,
}));

vi.mock('@/features/agent-runtime/agentRuntime', () => ({
  retryFailedChatTurn: retryFailedChatTurnMock,
}));

vi.mock('@/features/discord/byopBootstrap', () => ({
  buildGuildApiKeyMissingResponse: buildGuildApiKeyMissingResponseMock,
}));

vi.mock('@/features/discord/interactiveComponentService', () => ({
  buildActionButtonComponent: vi.fn((params: { customId: string; label: string; style?: string }) => ({
    type: 2,
    custom_id: params.customId,
    label: params.label,
    style: params.style === 'primary' ? 1 : 2,
  })),
  buildModalForInteractiveSession: vi.fn(),
  buildPromptFromInteractiveModalSubmission: vi.fn(),
  consumeActiveInteractiveSession: consumeActiveInteractiveSessionMock,
  createInteractiveButtonSession: createInteractiveButtonSessionMock,
  getActiveInteractiveSession: getActiveInteractiveSessionMock,
  interactiveButtonActionSchema: z.any(),
  parseInteractiveModalCustomId: vi.fn(),
  parseInteractiveSessionCustomId: parseInteractiveSessionCustomIdMock,
}));

vi.mock('@/shared/observability/trace-id-generator', () => ({
  generateTraceId: vi.fn(() => 'trace-1'),
}));

vi.mock('@/shared/text/message-splitter', () => ({
  smartSplit: vi.fn((value: string) => [value]),
}));

vi.mock('@/platform/discord/admin-permissions', () => ({
  isAdminFromMember: isAdminFromMemberMock,
  isModeratorFromMember: isModeratorFromMemberMock,
  resolveAuthorityTierFromMember: resolveAuthorityTierFromMemberMock,
}));

vi.mock('@/platform/discord/client', () => ({
  client: {
    user: { id: 'sage-bot' },
  },
}));

import { handleInteractiveButtonSession } from '@/app/discord/handlers/interactiveSage';

describe('interactiveSage delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAdminFromMemberMock.mockReturnValue(true);
    isModeratorFromMemberMock.mockReturnValue(true);
    resolveAuthorityTierFromMemberMock.mockReturnValue('admin');
    consumeActiveInteractiveSessionMock.mockResolvedValue(true);
  });

  it('keeps the deferred interaction visible when approval handoff returns a draft', async () => {
    parseInteractiveSessionCustomIdMock.mockReturnValue('session-1');
    getActiveInteractiveSessionMock.mockResolvedValue({
      kind: 'prompt_button',
      prompt: 'update the Sage Persona',
      visibility: 'ephemeral',
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });
    generateChatReplyMock.mockResolvedValue({
      replyText: 'Working on that now.',
      delivery: 'approval_handoff',
      meta: {
        approvalReview: {
          requestId: 'approval-1',
          sourceChannelId: 'channel-1',
          reviewChannelId: 'review-1',
        },
      },
      files: [],
    });

    const interaction = {
      customId: 'session-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      user: { id: 'user-1', username: 'user1', globalName: 'User One' },
      member: { displayName: 'User One' },
      deferred: false,
      replied: false,
      deferReply: vi.fn(async () => {
        interaction.deferred = true;
      }),
      deleteReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    };

    const handled = await handleInteractiveButtonSession(interaction as never);

    expect(handled).toBe(true);
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.deleteReply).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it('still returns approval-handoff files without a duplicate placeholder', async () => {
    parseInteractiveSessionCustomIdMock.mockReturnValue('session-1-files');
    getActiveInteractiveSessionMock.mockResolvedValue({
      kind: 'prompt_button',
      prompt: 'prepare the report and update the Sage Persona',
      visibility: 'ephemeral',
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });
    const attachment = Buffer.from('report body');
    generateChatReplyMock.mockResolvedValue({
      replyText: '',
      delivery: 'approval_handoff',
      meta: {
        approvalReview: {
          requestId: 'approval-1',
          sourceChannelId: 'channel-1',
          reviewChannelId: 'review-1',
        },
      },
      files: [{ attachment, name: 'report.txt' }],
    });

    const interaction = {
      customId: 'session-1-files',
      channelId: 'channel-1',
      guildId: 'guild-1',
      user: { id: 'user-1', username: 'user1', globalName: 'User One' },
      member: { displayName: 'User One' },
      deferred: false,
      replied: false,
      deferReply: vi.fn(async () => {
        interaction.deferred = true;
      }),
      deleteReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    };

    const handled = await handleInteractiveButtonSession(interaction as never);

    expect(handled).toBe(true);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [{ attachment, name: 'report.txt' }],
      }),
    );
    expect(interaction.deleteReply).not.toHaveBeenCalled();
  });

  it('keeps self-hosted missing-key replies in plain text instead of showing Pollinations setup controls', async () => {
    parseInteractiveSessionCustomIdMock.mockReturnValue('session-self-hosted');
    getActiveInteractiveSessionMock.mockResolvedValue({
      kind: 'prompt_button',
      prompt: 'hello',
      visibility: 'ephemeral',
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });
    generateChatReplyMock.mockResolvedValue({
      replyText:
        "I'm not set up to chat in this server yet, so please ask the bot operator to add the AI provider key.",
      delivery: 'response_session',
      meta: {
        kind: 'missing_api_key',
        missingApiKey: {
          recovery: 'host_api_key',
        },
      },
      files: [],
    });

    const interaction = {
      customId: 'session-self-hosted',
      channelId: 'channel-1',
      guildId: 'guild-1',
      user: { id: 'user-1', username: 'user1', globalName: 'User One' },
      member: { displayName: 'User One' },
      deferred: false,
      replied: false,
      deferReply: vi.fn(async () => {
        interaction.deferred = true;
      }),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    };

    const handled = await handleInteractiveButtonSession(interaction as never);

    expect(handled).toBe(true);
    expect(buildGuildApiKeyMissingResponseMock).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("I'm not set up to chat in this server yet"),
      }),
    );
  });

  it('still renders hosted server-key recovery controls when the runtime explicitly requests that path', async () => {
    parseInteractiveSessionCustomIdMock.mockReturnValue('session-hosted');
    getActiveInteractiveSessionMock.mockResolvedValue({
      kind: 'prompt_button',
      prompt: 'hello',
      visibility: 'ephemeral',
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });
    generateChatReplyMock.mockResolvedValue({
      replyText: 'Sage is waiting for server activation here.',
      delivery: 'response_session',
      meta: {
        kind: 'missing_api_key',
        missingApiKey: {
          recovery: 'server_key_activation',
        },
      },
      files: [],
    });

    const interaction = {
      customId: 'session-hosted',
      channelId: 'channel-1',
      guildId: 'guild-1',
      user: { id: 'user-1', username: 'user1', globalName: 'User One' },
      member: { displayName: 'User One' },
      deferred: false,
      replied: false,
      deferReply: vi.fn(async () => {
        interaction.deferred = true;
      }),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    };

    const handled = await handleInteractiveButtonSession(interaction as never);

    expect(handled).toBe(true);
    expect(buildGuildApiKeyMissingResponseMock).toHaveBeenCalledWith({ isAdmin: true });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: 32768,
        components: [],
        withComponents: true,
      }),
    );
  });

  it('does not create a legacy Continue button for plain response-session updates', async () => {
    parseInteractiveSessionCustomIdMock.mockReturnValue('session-2');
    getActiveInteractiveSessionMock.mockResolvedValue({
      kind: 'prompt_button',
      prompt: 'keep going',
      visibility: 'ephemeral',
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });
    generateChatReplyMock.mockResolvedValue({
      replyText: 'I checked the first batch and I am still working in the background.',
      delivery: 'response_session',
      meta: undefined,
      files: [],
    });

    const interaction = {
      customId: 'session-2',
      channelId: 'channel-1',
      guildId: 'guild-1',
      user: { id: 'user-1', username: 'user1', globalName: 'User One' },
      member: { displayName: 'User One' },
      deferred: false,
      replied: false,
      deferReply: vi.fn(async () => {
        interaction.deferred = true;
      }),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    };

    const handled = await handleInteractiveButtonSession(interaction as never);

    expect(handled).toBe(true);
    expect(createInteractiveButtonSessionMock).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'I checked the first batch and I am still working in the background.',
      }),
    );
  });

  it('publishes a Retry button when the runtime returns retry metadata', async () => {
    parseInteractiveSessionCustomIdMock.mockReturnValue('session-retry');
    getActiveInteractiveSessionMock.mockResolvedValue({
      kind: 'prompt_button',
      prompt: 'hello again',
      visibility: 'ephemeral',
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });
    generateChatReplyMock.mockResolvedValue({
      replyText: 'I lost the model connection before I could finish, so please try again.',
      delivery: 'response_session',
      meta: {
        retry: {
          threadId: 'thread-1',
          retryKind: 'turn',
        },
      },
      files: [],
    });

    const interaction = {
      customId: 'session-retry',
      channelId: 'channel-1',
      guildId: 'guild-1',
      user: { id: 'user-1', username: 'user1', globalName: 'User One' },
      member: { displayName: 'User One' },
      deferred: false,
      replied: false,
      deferReply: vi.fn(async () => {
        interaction.deferred = true;
      }),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    };

    const handled = await handleInteractiveButtonSession(interaction as never);

    expect(handled).toBe(true);
    expect(createInteractiveButtonSessionMock).toHaveBeenCalledWith({
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      action: {
        type: 'graph_retry',
        threadId: 'thread-1',
        retryKind: 'turn',
        visibility: 'ephemeral',
      },
    });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: 32768,
        components: [
          expect.objectContaining({
            type: 17,
            components: expect.arrayContaining([
              expect.objectContaining({
                content:
                  'I lost the model connection before I could finish, so please try again.',
              }),
              expect.objectContaining({
                type: 1,
                components: [
                  expect.objectContaining({
                    custom_id: 'sage:ui:continue-1',
                    label: 'Retry',
                  }),
                ],
              }),
            ]),
          }),
        ],
      }),
    );
  });

  it('retries a failed turn via the Retry button flow', async () => {
    parseInteractiveSessionCustomIdMock.mockReturnValue('session-retry-flow');
    getActiveInteractiveSessionMock.mockResolvedValue({
      kind: 'graph_retry_button',
      threadId: 'thread-9',
      retryKind: 'turn',
      visibility: 'ephemeral',
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });
    retryFailedChatTurnMock.mockResolvedValue({
      replyText: 'Recovered after retry.',
      delivery: 'response_session',
      meta: undefined,
      files: [],
    });

    const interaction = {
      customId: 'session-retry-flow',
      id: 'interaction-retry-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      user: { id: 'user-1', username: 'user1', globalName: 'User One' },
      member: { displayName: 'User One' },
      deferred: false,
      replied: false,
      deferReply: vi.fn(async () => {
        interaction.deferred = true;
      }),
      deferUpdate: vi.fn(async () => {
        interaction.deferred = true;
      }),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    };

    const handled = await handleInteractiveButtonSession(interaction as never);

    expect(handled).toBe(true);
    expect(retryFailedChatTurnMock).toHaveBeenCalledWith({
      traceId: 'trace-1',
      threadId: 'thread-9',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      retryKind: 'turn',
      invokerAuthority: 'admin',
      isAdmin: true,
      canModerate: true,
    });
    expect(consumeActiveInteractiveSessionMock).toHaveBeenCalledWith('session-retry-flow', {
      kind: 'graph_retry_button',
      threadId: 'thread-9',
      retryKind: 'turn',
      visibility: 'ephemeral',
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });
    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: 32768,
        components: [
          expect.objectContaining({
            type: 17,
            components: expect.arrayContaining([
              expect.objectContaining({
                content: 'Recovered after retry.',
              }),
            ]),
          }),
        ],
      }),
    );
  });

  it('blocks repeated Retry clicks after the first session claim', async () => {
    parseInteractiveSessionCustomIdMock.mockReturnValue('session-retry-repeat');
    getActiveInteractiveSessionMock.mockResolvedValue({
      kind: 'graph_retry_button',
      threadId: 'thread-repeat',
      retryKind: 'turn',
      visibility: 'ephemeral',
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });
    consumeActiveInteractiveSessionMock.mockResolvedValueOnce(false);

    const interaction = {
      customId: 'session-retry-repeat',
      id: 'interaction-retry-repeat',
      channelId: 'channel-1',
      guildId: 'guild-1',
      user: { id: 'user-1', username: 'user1', globalName: 'User One' },
      member: { displayName: 'User One' },
      deferred: false,
      replied: false,
      deferUpdate: vi.fn(async () => {
        interaction.deferred = true;
      }),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    };

    const handled = await handleInteractiveButtonSession(interaction as never);

    expect(handled).toBe(true);
    expect(retryFailedChatTurnMock).not.toHaveBeenCalled();
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'That Sage button was already used, so please ask me for a new one if you still need it.',
      ephemeral: true,
    });
  });
});
