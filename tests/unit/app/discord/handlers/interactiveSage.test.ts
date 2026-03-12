import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateChatReplyMock = vi.hoisted(() => vi.fn());
const parseInteractiveSessionCustomIdMock = vi.hoisted(() => vi.fn());
const getActiveInteractiveSessionMock = vi.hoisted(() => vi.fn());
const isAdminFromMemberMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/features/chat/chat-engine', () => ({
  generateChatReply: generateChatReplyMock,
}));

vi.mock('@/features/discord/byopBootstrap', () => ({
  buildGuildApiKeyMissingResponse: vi.fn(() => ({
    content: 'missing key',
    components: [],
  })),
}));

vi.mock('@/features/discord/interactiveComponentService', () => ({
  buildModalForInteractiveSession: vi.fn(),
  buildPromptFromInteractiveModalSubmission: vi.fn(),
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

describe('interactiveSage approval delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acknowledges approval-governance-only turns without trying to publish a normal reply', async () => {
    parseInteractiveSessionCustomIdMock.mockReturnValue('session-1');
    getActiveInteractiveSessionMock.mockResolvedValue({
      kind: 'prompt_button',
      prompt: 'update the Sage Persona',
      visibility: 'ephemeral',
    });
    generateChatReplyMock.mockResolvedValue({
      replyText: '',
      delivery: 'approval_governance_only',
      meta: undefined,
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
      content: 'Approval review posted.',
      files: [],
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it('keeps generated files attached when approval-governance-only turns are returned', async () => {
    parseInteractiveSessionCustomIdMock.mockReturnValue('session-2');
    getActiveInteractiveSessionMock.mockResolvedValue({
      kind: 'prompt_button',
      prompt: 'generate a report then queue the update',
      visibility: 'ephemeral',
    });
    const attachment = Buffer.from('generated file');
    generateChatReplyMock.mockResolvedValue({
      replyText: '',
      delivery: 'approval_governance_only',
      meta: undefined,
      files: [{ attachment, name: 'report.txt' }],
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
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Approval review posted.',
      files: [{ attachment, name: 'report.txt' }],
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
});
