import type { Message, PartialMessage, User } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClient = vi.hoisted(() => ({
  user: { id: 'sage-bot' },
}));

const mockIngestEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockIsLoggingEnabled = vi.hoisted(() => vi.fn(() => true));
const mockEvaluateMessageModeration = vi.hoisted(() => vi.fn().mockResolvedValue({ suppressInvocation: false }));

vi.mock('@/platform/discord/client', () => ({
  client: mockClient,
}));

vi.mock('@/features/ingest/ingestEvent', () => ({
  ingestEvent: mockIngestEvent,
}));

vi.mock('@/features/settings/guildChannelSettings', () => ({
  isLoggingEnabled: mockIsLoggingEnabled,
}));

vi.mock('@/features/moderation/runtime', () => ({
  evaluateMessageModeration: mockEvaluateMessageModeration,
}));

import {
  __resetMessageUpdateHandlerStateForTests,
  handleMessageUpdate,
} from '@/app/discord/handlers/messageUpdate';

function createUpdatedMessage(overrides: Record<string, unknown> = {}): Message {
  return {
    id: 'msg-1',
    partial: false,
    guildId: 'guild-1',
    channelId: 'channel-1',
    createdAt: new Date('2026-03-15T00:00:00.000Z'),
    author: {
      id: 'bot-1',
      username: 'Sage',
      bot: true,
    } as unknown as User,
    member: {
      displayName: 'Sage',
    },
    content: '',
    components: [
      {
        type: 17,
        components: [
          {
            type: 10,
            content: 'Retry completed successfully.',
          },
        ],
      },
    ],
    mentions: {
      has: vi.fn(() => false),
      users: new Map<string, User>(),
    },
    reference: null,
    ...overrides,
  } as unknown as Message;
}

describe('messageUpdate handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetMessageUpdateHandlerStateForTests();
    mockIsLoggingEnabled.mockReturnValue(true);
    mockEvaluateMessageModeration.mockResolvedValue({ suppressInvocation: false });
  });

  it('re-ingests edited bot messages using visible Components V2 text', async () => {
    const updatedMessage = createUpdatedMessage();

    await handleMessageUpdate(updatedMessage, updatedMessage);

    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-1',
        authorIsBot: true,
        content: 'Retry completed successfully.',
      }),
    );
  });

  it('fetches partial edited bot messages before ingesting them', async () => {
    const fetchedMessage = createUpdatedMessage({
      id: 'msg-partial-1',
      components: [],
      embeds: [
        {
          description: 'Approval finished and the source message was updated.',
        },
      ],
    });
    const partialMessage = {
      id: 'msg-partial-1',
      partial: true,
      fetch: vi.fn().mockResolvedValue(fetchedMessage),
    } as unknown as PartialMessage;

    await handleMessageUpdate(partialMessage, partialMessage);

    expect((partialMessage.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-partial-1',
        content: 'Approval finished and the source message was updated.',
      }),
    );
  });

  it('ignores edited human messages so file-ingest notes are not clobbered by a generic edit path', async () => {
    const updatedMessage = createUpdatedMessage({
      author: {
        id: 'user-1',
        username: 'Itris',
        bot: false,
      } as unknown as User,
    });

    await handleMessageUpdate(updatedMessage, updatedMessage);

    expect(mockEvaluateMessageModeration).toHaveBeenCalledWith(
      expect.objectContaining({
        message: updatedMessage,
        isEdit: true,
      }),
    );
    expect(mockIngestEvent).not.toHaveBeenCalled();
  });
});
