import type { Message, TextChannel, User } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateChatReply, mockClient, mockFetchAttachmentText } = vi.hoisted(() => {
  const mockGenerateChatReply = vi.fn();
  const mockClient = {
    user: { id: '123', tag: 'SageBot#0001' },
  };
  const mockFetchAttachmentText = vi.fn();
  return { mockGenerateChatReply, mockClient, mockFetchAttachmentText };
});

const mockIsRateLimited = vi.hoisted(() => vi.fn(() => false));
const mockIsLoggingEnabled = vi.hoisted(() => vi.fn(() => true));
const mockGenerateTraceId = vi.hoisted(() => vi.fn(() => 'test-trace-id'));
const mockIngestEvent = vi.hoisted(() => vi.fn());
const mockUpsertIngestedAttachment = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDeleteAttachmentChunks = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockIngestAttachmentText = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/core/chat-engine', () => ({
  generateChatReply: mockGenerateChatReply,
}));

vi.mock('@/core/utils/file-handler', () => ({
  fetchAttachmentText: mockFetchAttachmentText,
}));

vi.mock('@/core/rate-limiter', () => ({
  isRateLimited: mockIsRateLimited,
}));

vi.mock('@/core/settings/guildChannelSettings', () => ({
  isLoggingEnabled: mockIsLoggingEnabled,
}));

vi.mock('@/core/utils/trace-id-generator', () => ({
  generateTraceId: mockGenerateTraceId,
}));

vi.mock('@/core/ingest/ingestEvent', () => ({
  ingestEvent: mockIngestEvent,
}));

vi.mock('@/core/attachments/ingestedAttachmentRepo', () => ({
  upsertIngestedAttachment: mockUpsertIngestedAttachment,
}));

vi.mock('@/core/embeddings', () => ({
  deleteAttachmentChunks: mockDeleteAttachmentChunks,
  ingestAttachmentText: mockIngestAttachmentText,
}));

vi.mock('@/bot/client', () => ({
  client: mockClient,
}));

let handleMessageCreate: (message: Message) => Promise<void>;
let resetInvocationCooldowns: () => void;

let messageCounter = 0;

function createMockMessage(overrides: Record<string, unknown> = {}): Message {
  messageCounter += 1;

  const author = {
    id: 'user-456',
    bot: false,
    username: 'TestUser',
  } as unknown as User;

  const channel = {
    send: vi.fn().mockResolvedValue(undefined),
    sendTyping: vi.fn().mockResolvedValue(undefined),
  } as unknown as TextChannel;

  const baseMock: Record<string, unknown> = {
    id: `msg-${messageCounter}`,
    content: 'Hello bot!',
    author,
    member: {
      displayName: 'TestUser',
    },
    guildId: 'guild-789',
    channelId: 'channel-101',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    mentions: {
      has: vi.fn(() => false),
      users: new Map<string, User>(),
    },
    reference: null,
    fetchReference: vi.fn(),
    attachments: {
      first: vi.fn(() => null),
      values: vi.fn(() => []),
    },
    channel,
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return baseMock as unknown as Message;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('messageCreate - ingest + reply gating', () => {
  beforeEach(async () => {
    vi.resetModules();
    const processedKey = Symbol.for('sage.handlers.messageCreate.processed');
    const registrationKey = Symbol.for('sage.handlers.messageCreate.registered');
    const g = globalThis as unknown as { [key: symbol]: unknown };
    delete g[processedKey];
    delete g[registrationKey];

    mockGenerateChatReply.mockResolvedValue({ replyText: 'Test response' });
    mockFetchAttachmentText.mockResolvedValue({
      kind: 'ok',
      text: 'default file text',
      extractor: 'tika',
      byteLength: 16,
      mimeType: 'text/plain',
    });
    mockIsRateLimited.mockReturnValue(false);
    mockIsLoggingEnabled.mockReturnValue(true);
    mockDeleteAttachmentChunks.mockResolvedValue(undefined);
    mockIngestAttachmentText.mockResolvedValue(undefined);

    ({ resetInvocationCooldowns } = await import('@/core/invocation/invocation-rate-limiter'));
    resetInvocationCooldowns();

    ({ handleMessageCreate } = await import('@/bot/handlers/messageCreate'));
  });

  it('does not call generateChatReply for non-mention messages', async () => {
    const message = createMockMessage({
      content: 'Regular message without mention',
    });

    await handleMessageCreate(message);

    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: message.id }),
    );
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
    expect((message as unknown as { reply: ReturnType<typeof vi.fn> }).reply).not.toHaveBeenCalled();
  });

  it('calls generateChatReply for wakeword requests and replies', async () => {
    const message = createMockMessage({
      content: 'sage summarize what they are talking about',
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: 'summarize what they are talking about',
      }),
    );
    expect((message as unknown as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalled();
  });

  it('applies wakeword cooldown per user/channel', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    const firstMessage = createMockMessage({
      content: 'sage summarize this',
      channelId: 'channel-cooldown',
    });

    const secondMessage = createMockMessage({
      content: 'sage summarize again',
      channelId: 'channel-cooldown',
    });

    await handleMessageCreate(firstMessage);
    await handleMessageCreate(secondMessage);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    expect(mockIngestEvent).toHaveBeenCalledTimes(2);
  });

  it('ignores mid-sentence wakeword mentions', async () => {
    const message = createMockMessage({
      content: 'I met Sage yesterday at the park',
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).not.toHaveBeenCalled();
    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: message.id }),
    );
  });

  it('calls generateChatReply for mentions', async () => {
    const message = createMockMessage({
      content: '<@123> Hello!',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
    });

    await handleMessageCreate(message);

    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: message.id }),
    );
    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    expect((message as unknown as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalled();
  });

  it('skips reply generation when channel cannot send typing updates', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const message = createMockMessage({
      content: '<@123> Hello!',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      channel: {} as unknown as TextChannel,
      reply,
    });

    await handleMessageCreate(message);

    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: message.id }),
    );
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('passes non-bot mention ids consistently to ingest and reply generation', async () => {
    const mentionedA = {
      id: 'user-a',
      bot: false,
      username: 'UserA',
    } as unknown as User;
    const mentionedB = {
      id: 'user-b',
      bot: false,
      username: 'UserB',
    } as unknown as User;
    const botMention = {
      id: '123',
      bot: true,
      username: 'SageBot',
    } as unknown as User;

    const message = createMockMessage({
      content: '<@123> hey <@user-a> and <@user-b>',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>([
          ['123', botMention],
          ['user-a', mentionedA],
          ['user-b', mentionedB],
        ]),
      },
    });

    await handleMessageCreate(message);

    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionsUserIds: ['user-a', 'user-b'],
      }),
    );
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionedUserIds: ['user-a', 'user-b'],
      }),
    );
  });

  it('treats replies as replies even when mentioning the bot', async () => {
    const fetchReference = vi.fn().mockResolvedValue({
      author: { id: '123', bot: true },
      content: 'Prior bot message',
      attachments: {
        first: vi.fn(() => null),
      },
      partial: false,
    });

    const message = createMockMessage({
      content: '<@123> following up on your reply',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      reference: { messageId: 'ref-1' },
      fetchReference,
    });

    await handleMessageCreate(message);

    expect(fetchReference).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyToBotText: 'Prior bot message',
      }),
    );
  });

  it('includes reply reference content', async () => {
    const referencedMessage = {
      author: { id: 'user-999', bot: false },
      content: 'Original question',
      attachments: {
        first: vi.fn(() => null),
      },
      partial: false,
    };

    const message = createMockMessage({
      content: '<@123> follow up',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      reference: { messageId: 'ref-2' },
      referencedMessage,
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyReferenceContent: '[In reply to]: Original question',
      }),
    );
  });

  it('includes reply reference images as multimodal content', async () => {
    const referencedMessage = {
      author: { id: 'user-999', bot: false },
      content: '',
      attachments: {
        first: vi.fn(() => ({
          contentType: 'image/png',
          url: 'https://cdn.example.com/image.png',
        })),
      },
      partial: false,
    };

    const message = createMockMessage({
      content: '<@123> what do you think?',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      reference: { messageId: 'ref-3' },
      referencedMessage,
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyReferenceContent: [
          { type: 'text', text: '[In reply to]: ' },
          { type: 'image_url', image_url: { url: 'https://cdn.example.com/image.png' } },
        ],
      }),
    );
  });

  it('ingests bot messages but skips reply generation', async () => {
    const message = createMockMessage({
      author: {
        id: 'other-bot',
        bot: true,
        username: 'Bot',
      },
    });

    await handleMessageCreate(message);

    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: message.id,
        authorIsBot: true,
      }),
    );
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
  });

  it('ingests non-mention messages even though bot does not reply', async () => {
    const message = createMockMessage({
      content: 'Just chatting without mentioning bot',
    });

    await handleMessageCreate(message);

    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: message.id }),
    );
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
  });

  it('ingests and forwards multiple non-image attachments', async () => {
    mockFetchAttachmentText
      .mockResolvedValueOnce({
        kind: 'ok',
        text: 'alpha body',
        extractor: 'tika',
        byteLength: 20,
        mimeType: 'text/plain',
      })
      .mockResolvedValueOnce({
        kind: 'ok',
        text: 'beta body',
        extractor: 'tika',
        byteLength: 24,
        mimeType: 'text/markdown',
      });

    const message = createMockMessage({
      content: '<@123> review these',
      channelId: 'channel-files',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      attachments: {
        values: vi.fn(() => [
          {
            name: 'alpha.txt',
            url: 'https://cdn.discordapp.com/alpha.txt',
            contentType: 'text/plain',
            size: 20,
          },
          {
            name: 'beta.md',
            url: 'https://cdn.discordapp.com/beta.md',
            contentType: 'text/markdown',
            size: 24,
          },
        ]),
        first: vi.fn(() => null),
      },
    });

    await handleMessageCreate(message);

    expect(mockFetchAttachmentText).toHaveBeenCalledTimes(2);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: expect.stringContaining('BEGIN FILE ATTACHMENT: alpha.txt'),
      }),
    );
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: expect.stringContaining('BEGIN FILE ATTACHMENT: beta.md'),
      }),
    );

    expect(mockIngestEvent).toHaveBeenCalledTimes(1);
    const ingestPayload = mockIngestEvent.mock.calls[0]?.[0] as { content?: string };
    expect(ingestPayload.content).toContain('Attachment cache processed 2 non-image attachment(s)');
    expect(ingestPayload.content).not.toContain('BEGIN FILE ATTACHMENT');
  });

  it('queues embedding updates after attachment cache persistence', async () => {
    mockFetchAttachmentText.mockResolvedValueOnce({
      kind: 'ok',
      text: 'gamma body',
      extractor: 'tika',
      byteLength: 20,
      mimeType: 'text/plain',
    });
    mockUpsertIngestedAttachment.mockResolvedValueOnce({ id: 'attachment-row-1' });

    const message = createMockMessage({
      content: '<@123> index this',
      channelId: 'channel-files',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      attachments: {
        values: vi.fn(() => [
          {
            name: 'gamma.txt',
            url: 'https://cdn.discordapp.com/gamma.txt',
            contentType: 'text/plain',
            size: 20,
          },
        ]),
        first: vi.fn(() => null),
      },
    });

    await handleMessageCreate(message);
    await flushMicrotasks();

    expect(mockUpsertIngestedAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: message.id,
        status: 'ok',
        extractedText: 'gamma body',
      }),
    );
    expect(mockDeleteAttachmentChunks).toHaveBeenCalledWith('attachment-row-1');
    expect(mockIngestAttachmentText).toHaveBeenCalledWith('attachment-row-1', 'gamma body');
  });
});
