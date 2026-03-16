import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateChatReplyMock = vi.hoisted(() => vi.fn());
const resumeContinuationChatTurnMock = vi.hoisted(() => vi.fn());
const retryFailedChatTurnMock = vi.hoisted(() => vi.fn());
const parseInteractiveSessionCustomIdMock = vi.hoisted(() => vi.fn());
const getActiveInteractiveSessionMock = vi.hoisted(() => vi.fn());
const consumeActiveInteractiveSessionMock = vi.hoisted(() => vi.fn());
const createInteractiveButtonSessionMock = vi.hoisted(() => vi.fn(async () => 'sage:ui:continue-1'));
const isAdminFromMemberMock = vi.hoisted(() => vi.fn(() => true));
const isModeratorFromMemberMock = vi.hoisted(() => vi.fn(() => true));
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
  resumeContinuationChatTurn: resumeContinuationChatTurnMock,
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

  it('publishes a continuation summary with a Continue button', async () => {
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
      replyText: 'I checked the first batch and can continue from here.',
      delivery: 'response_session_with_continue',
      meta: {
        continuation: {
          id: 'cont-1',
          expiresAtIso: '2026-03-13T09:40:00.000Z',
          completedWindows: 1,
          maxWindows: 4,
          summaryText: 'I checked the first batch and can continue from here.',
        },
      },
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
    expect(createInteractiveButtonSessionMock).toHaveBeenCalledWith({
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      action: {
        type: 'graph_continue',
        continuationId: 'cont-1',
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
                content: 'I checked the first batch and can continue from here.',
              }),
              expect.objectContaining({
                type: 1,
                components: [
                  expect.objectContaining({
                    custom_id: 'sage:ui:continue-1',
                    label: 'Continue (2/4)',
                  }),
                ],
              }),
            ]),
          }),
        ],
      }),
    );
  });

  it('still publishes a continuation summary when button session creation fails', async () => {
    parseInteractiveSessionCustomIdMock.mockReturnValue('session-2b');
    getActiveInteractiveSessionMock.mockResolvedValue({
      kind: 'prompt_button',
      prompt: 'keep going',
      visibility: 'ephemeral',
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });
    createInteractiveButtonSessionMock.mockRejectedValueOnce(new Error('session store offline'));
    generateChatReplyMock.mockResolvedValue({
      replyText: 'I checked the first batch and can continue from here.',
      delivery: 'response_session_with_continue',
      meta: {
        continuation: {
          id: 'cont-1b',
          expiresAtIso: '2026-03-13T09:40:00.000Z',
          completedWindows: 1,
          maxWindows: 4,
          summaryText: 'I checked the first batch and can continue from here.',
        },
      },
      files: [],
    });

    const interaction = {
      customId: 'session-2b',
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
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'I checked the first batch and can continue from here.',
        files: [],
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

  it('resumes graph continuation sessions instead of generating a fresh prompt turn', async () => {
    parseInteractiveSessionCustomIdMock.mockReturnValue('session-3');
    getActiveInteractiveSessionMock.mockResolvedValue({
      kind: 'graph_continue_button',
      continuationId: 'cont-2',
      visibility: 'ephemeral',
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });
    resumeContinuationChatTurnMock.mockResolvedValue({
      replyText: 'Resumed and finished.',
      delivery: 'response_session',
      meta: undefined,
      files: [],
    });

    const interaction = {
      customId: 'session-3',
      id: 'interaction-3',
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
    expect(resumeContinuationChatTurnMock).toHaveBeenCalledWith({
      traceId: 'trace-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      continuationId: 'cont-2',
      isAdmin: true,
      canModerate: true,
    });
    expect(consumeActiveInteractiveSessionMock).toHaveBeenCalledWith('session-3', {
      kind: 'graph_continue_button',
      continuationId: 'cont-2',
      visibility: 'ephemeral',
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });
    expect(generateChatReplyMock).not.toHaveBeenCalled();
    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: 32768,
        components: [
          expect.objectContaining({
            type: 17,
            components: expect.arrayContaining([
              expect.objectContaining({
                content: 'Resumed and finished.',
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

  it('rejects Continue clicks from a different user before attempting resume', async () => {
    parseInteractiveSessionCustomIdMock.mockReturnValue('session-4');
    getActiveInteractiveSessionMock.mockResolvedValue({
      kind: 'graph_continue_button',
      continuationId: 'cont-3',
      visibility: 'public',
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-owner',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });

    const interaction = {
      customId: 'session-4',
      id: 'interaction-4',
      channelId: 'channel-1',
      guildId: 'guild-1',
      user: { id: 'user-other', username: 'user2', globalName: 'User Two' },
      member: { displayName: 'User Two' },
      deferred: false,
      replied: false,
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    };

    const handled = await handleInteractiveButtonSession(interaction as never);

    expect(handled).toBe(true);
    expect(consumeActiveInteractiveSessionMock).not.toHaveBeenCalled();
    expect(resumeContinuationChatTurnMock).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'I can only continue this for the person who started it.',
      ephemeral: true,
    });
  });

  it('rejects Continue clicks from the wrong channel with a channel-specific recovery hint', async () => {
    parseInteractiveSessionCustomIdMock.mockReturnValue('session-5');
    getActiveInteractiveSessionMock.mockResolvedValue({
      kind: 'graph_continue_button',
      continuationId: 'cont-4',
      visibility: 'public',
      guildId: 'guild-1',
      channelId: 'channel-home',
      createdByUserId: 'user-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });

    const interaction = {
      customId: 'session-5',
      id: 'interaction-5',
      channelId: 'channel-other',
      guildId: 'guild-1',
      user: { id: 'user-1', username: 'user1', globalName: 'User One' },
      member: { displayName: 'User One' },
      deferred: false,
      replied: false,
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    };

    const handled = await handleInteractiveButtonSession(interaction as never);

    expect(handled).toBe(true);
    expect(consumeActiveInteractiveSessionMock).not.toHaveBeenCalled();
    expect(resumeContinuationChatTurnMock).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'I can only continue this in <#channel-home>.',
      ephemeral: true,
    });
  });

  it('blocks repeated Continue clicks after the first session claim', async () => {
    parseInteractiveSessionCustomIdMock.mockReturnValue('session-continue-repeat');
    getActiveInteractiveSessionMock.mockResolvedValue({
      kind: 'graph_continue_button',
      continuationId: 'cont-repeat',
      visibility: 'ephemeral',
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });
    consumeActiveInteractiveSessionMock.mockResolvedValueOnce(false);

    const interaction = {
      customId: 'session-continue-repeat',
      id: 'interaction-continue-repeat',
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
    expect(consumeActiveInteractiveSessionMock).toHaveBeenCalledWith('session-continue-repeat', {
      kind: 'graph_continue_button',
      continuationId: 'cont-repeat',
      visibility: 'ephemeral',
      guildId: 'guild-1',
      channelId: 'channel-1',
      createdByUserId: 'user-1',
      expiresAt: new Date('2026-03-14T00:00:00.000Z'),
    });
    expect(resumeContinuationChatTurnMock).not.toHaveBeenCalled();
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'That Sage button was already used, so please ask me for a new one if you still need it.',
      ephemeral: true,
    });
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
