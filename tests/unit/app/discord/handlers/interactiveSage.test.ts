import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateChatReplyMock = vi.hoisted(() => vi.fn());
const resumeContinuationChatTurnMock = vi.hoisted(() => vi.fn());
const parseInteractiveSessionCustomIdMock = vi.hoisted(() => vi.fn());
const getActiveInteractiveSessionMock = vi.hoisted(() => vi.fn());
const createInteractiveButtonSessionMock = vi.hoisted(() => vi.fn(async () => 'sage:ui:continue-1'));
const isAdminFromMemberMock = vi.hoisted(() => vi.fn(() => true));
const buildGuildApiKeyMissingResponseMock = vi.hoisted(() =>
  vi.fn(() => ({
    content: 'missing key',
    components: [],
  })),
);

vi.mock('@/features/chat/chat-engine', () => ({
  generateChatReply: generateChatReplyMock,
}));

vi.mock('@/features/agent-runtime/agentRuntime', () => ({
  resumeContinuationChatTurn: resumeContinuationChatTurnMock,
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
  });

  it('acknowledges approval-governance-only turns without trying to publish a normal reply', async () => {
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
      replyText: '',
      delivery: 'approval_governance_only',
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
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    };

    const handled = await handleInteractiveButtonSession(interaction as never);

    expect(handled).toBe(true);
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Approval review posted in <#review-1>. Next: I will update the status card when the review is resolved.',
      files: [],
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
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
        'Self-hosted Sage is not configured for chat in this server yet. Why: this bot instance has no `AI_PROVIDER_API_KEY`, and the hosted Pollinations server-key flow only applies to the hosted invite bot. Next: ask the bot operator to add the self-hosted provider key, then try again.',
      delivery: 'chat_reply',
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
        content: expect.stringContaining('Self-hosted Sage is not configured for chat in this server yet.'),
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
      delivery: 'chat_reply',
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
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'missing key',
      components: [],
      ephemeral: true,
    });
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
      delivery: 'chat_reply_with_continue',
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
        content: 'I checked the first batch and can continue from here.',
        components: [
          {
            type: 1,
            components: [
              expect.objectContaining({
                custom_id: 'sage:ui:continue-1',
                label: 'Continue (2/4)',
              }),
            ],
          },
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
      delivery: 'chat_reply_with_continue',
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
        components: undefined,
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
      delivery: 'chat_reply',
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
    });
    expect(generateChatReplyMock).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Resumed and finished.',
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
    expect(resumeContinuationChatTurnMock).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        'This Continue button belongs to the person who started this request. Next: ask them to continue it, or ask Sage to start a fresh pass for you.',
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
    expect(resumeContinuationChatTurnMock).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        'This Continue button only works in the original channel. Next: go back to <#channel-home> and use it there, or ask Sage for a fresh continuation here.',
      ephemeral: true,
    });
  });
});
