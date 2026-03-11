import type { Message, TextChannel, User } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const mockUpsertIngestedAttachment = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: 'attachment-row-default' }),
);
const mockDeleteAttachmentChunks = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockIngestAttachmentText = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockQueueImageAttachmentRecall = vi.hoisted(() => vi.fn());

vi.mock('@/features/chat/chat-engine', () => ({
  generateChatReply: mockGenerateChatReply,
}));

vi.mock('@/platform/files/file-handler', () => ({
  fetchAttachmentText: mockFetchAttachmentText,
}));

vi.mock('@/features/chat/rate-limiter', () => ({
  isRateLimited: mockIsRateLimited,
}));

vi.mock('@/features/settings/guildChannelSettings', () => ({
  isLoggingEnabled: mockIsLoggingEnabled,
}));

vi.mock('@/shared/observability/trace-id-generator', () => ({
  generateTraceId: mockGenerateTraceId,
}));

vi.mock('@/features/ingest/ingestEvent', () => ({
  ingestEvent: mockIngestEvent,
}));

vi.mock('@/features/attachments/ingestedAttachmentRepo', () => ({
  upsertIngestedAttachment: mockUpsertIngestedAttachment,
}));

vi.mock('@/features/embeddings', () => ({
  deleteAttachmentChunks: mockDeleteAttachmentChunks,
  ingestAttachmentText: mockIngestAttachmentText,
}));

vi.mock('@/features/attachments/imageAttachmentRecallWorker', () => ({
  queueImageAttachmentRecall: mockQueueImageAttachmentRecall,
}));

vi.mock('@/platform/discord/client', () => ({
  client: mockClient,
}));

import { config } from '@/platform/config/env';
import {
  __resetMessageCreateHandlerStateForTests,
  handleMessageCreate,
} from '@/app/discord/handlers/messageCreate';
import { resetInvocationCooldowns } from '@/features/invocation/invocation-rate-limiter';

let messageCounter = 0;
const defaultMaxAttachmentsPerMessage = config.FILE_INGEST_MAX_ATTACHMENTS_PER_MESSAGE;

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
  beforeEach(() => {
    __resetMessageCreateHandlerStateForTests();
    mockGenerateChatReply.mockReset();
    mockFetchAttachmentText.mockReset();
    mockIsRateLimited.mockReset();
    mockIsLoggingEnabled.mockReset();
    mockIngestEvent.mockReset();
    mockUpsertIngestedAttachment.mockReset();
    mockDeleteAttachmentChunks.mockReset();
    mockIngestAttachmentText.mockReset();
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
    mockUpsertIngestedAttachment.mockResolvedValue({ id: 'attachment-row-default' });
    mockQueueImageAttachmentRecall.mockReset();
    config.FILE_INGEST_MAX_ATTACHMENTS_PER_MESSAGE = defaultMaxAttachmentsPerMessage;
    messageCounter = 0;
    resetInvocationCooldowns();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('calls generateChatReply for wakeword-only image messages (default prompt)', async () => {
    const message = createMockMessage({
      content: 'sage',
      attachments: {
        values: vi.fn(() => [
          {
            name: 'image.png',
            url: 'https://cdn.discordapp.com/attachments/1/2/image.png',
            contentType: 'image/png',
            size: 1234,
          },
        ]),
        first: vi.fn(() => null),
      },
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: expect.stringContaining('Describe the image and answer any implied question.'),
      }),
    );
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

  it('calls generateChatReply for mention-only image messages (default prompt)', async () => {
    const message = createMockMessage({
      content: '<@123>',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      attachments: {
        values: vi.fn(() => [
          {
            name: 'image.png',
            url: 'https://cdn.discordapp.com/attachments/1/2/image.png',
            contentType: 'image/png',
            size: 1234,
          },
        ]),
        first: vi.fn(() => null),
      },
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    const call = mockGenerateChatReply.mock.calls[0]?.[0] as { userText?: string; userContent?: unknown };
    expect(call.userText).toContain('Describe the image and answer any implied question.');
    expect(call.userText).toContain('attachment:attachment-row-default');
    expect(Array.isArray(call.userContent)).toBe(true);
    const parts = call.userContent as Array<{ type?: string; image_url?: { url?: string } }>;
    expect(parts.some((part) => part.type === 'image_url')).toBe(true);
    expect(
      parts.find((part) => part.type === 'image_url')?.image_url?.url,
    ).toBe('https://cdn.discordapp.com/attachments/1/2/image.png');
  });

  it('includes embed image URLs as multimodal content', async () => {
    const message = createMockMessage({
      content: '<@123> what is this?',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      embeds: [
        {
          image: { url: 'https://example.com/embed.png' },
        },
      ],
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    const call = mockGenerateChatReply.mock.calls[0]?.[0] as { userContent?: unknown };
    expect(Array.isArray(call.userContent)).toBe(true);
    const parts = call.userContent as Array<{ type?: string; image_url?: { url?: string } }>;
    expect(
      parts.find((part) => part.type === 'image_url')?.image_url?.url,
    ).toBe('https://example.com/embed.png');
  });

  it('includes direct image URLs as multimodal content', async () => {
    const message = createMockMessage({
      content: '<@123> https://example.com/direct.png',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    const call = mockGenerateChatReply.mock.calls[0]?.[0] as { userContent?: unknown };
    expect(Array.isArray(call.userContent)).toBe(true);
    const parts = call.userContent as Array<{ type?: string; image_url?: { url?: string } }>;
    expect(
      parts.find((part) => part.type === 'image_url')?.image_url?.url,
    ).toBe('https://example.com/direct.png');
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
      id: 'ref-1',
      guildId: 'guild-789',
      channelId: 'channel-101',
      author: { id: '123', bot: true },
      member: null,
      content: 'Prior bot message',
      mentions: {
        users: new Map<string, User>(),
      },
      reference: null,
      attachments: {
        first: vi.fn(() => null),
        values: vi.fn(() => []),
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
        currentTurn: expect.objectContaining({
          invokedBy: 'reply',
          isDirectReply: true,
          replyTargetAuthorId: '123',
        }),
        replyTarget: expect.objectContaining({
          authorId: '123',
          authorIsBot: true,
          content: 'Prior bot message',
        }),
      }),
    );
  });

  it('includes reply reference content', async () => {
    const referencedMessage = {
      id: 'ref-2',
      guildId: 'guild-1',
      channelId: 'channel-1',
      author: { id: 'user-999', bot: false, username: 'Reply User' },
      member: null,
      content: 'Original question',
      mentions: {
        users: new Map<string, User>(),
      },
      reference: null,
      attachments: {
        first: vi.fn(() => null),
        values: vi.fn(() => []),
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
        replyTarget: expect.objectContaining({
          messageId: 'ref-2',
          authorId: 'user-999',
          content: 'Original question',
        }),
      }),
    );
  });

  it('includes reply reference images as multimodal content', async () => {
    const referencedMessage = {
      id: 'ref-3',
      guildId: 'guild-1',
      channelId: 'channel-1',
      author: { id: 'user-999', bot: false, username: 'Reply User' },
      member: null,
      content: '',
      mentions: {
        users: new Map<string, User>(),
      },
      reference: null,
      attachments: {
        first: vi.fn(() => ({
          contentType: 'image/png',
          url: 'https://cdn.example.com/image.png',
        })),
        values: vi.fn(() => [
          {
            contentType: 'image/png',
            url: 'https://cdn.example.com/image.png',
          },
        ]),
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
        replyTarget: expect.objectContaining({
          content: [
            { type: 'text', text: ' ' },
            { type: 'image_url', image_url: { url: 'https://cdn.example.com/image.png' } },
          ],
        }),
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
    mockUpsertIngestedAttachment
      .mockResolvedValueOnce({ id: 'attachment-row-alpha' })
      .mockResolvedValueOnce({ id: 'attachment-row-beta' });

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
    expect(ingestPayload.content).toContain('Attachment cache processed 2 attachment(s); cached attachments: 2.');
    expect(ingestPayload.content).toContain('Cached attachment references');
    expect(ingestPayload.content).toContain('discord_files action read_attachment');
    expect(ingestPayload.content).toContain('discord_files action send_attachment');
    expect(ingestPayload.content).toContain('attachment:attachment-row-alpha');
    expect(ingestPayload.content).not.toContain('BEGIN FILE ATTACHMENT');
  });

  it('keeps uncached images out of the per-message file ingest cap', async () => {
    config.FILE_INGEST_MAX_ATTACHMENTS_PER_MESSAGE = 3;
    mockIsLoggingEnabled.mockReturnValue(false);
    mockFetchAttachmentText
      .mockResolvedValueOnce({
        kind: 'ok',
        text: 'alpha pdf',
        extractor: 'tika',
        byteLength: 20,
        mimeType: 'application/pdf',
      })
      .mockResolvedValueOnce({
        kind: 'ok',
        text: 'beta pdf',
        extractor: 'tika',
        byteLength: 24,
        mimeType: 'application/pdf',
      })
      .mockResolvedValueOnce({
        kind: 'ok',
        text: 'gamma pdf',
        extractor: 'tika',
        byteLength: 28,
        mimeType: 'application/pdf',
      });

    const message = createMockMessage({
      content: '<@123> review these files',
      channelId: 'channel-no-cache',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      attachments: {
        values: vi.fn(() => [
          {
            name: 'preview.png',
            url: 'https://cdn.discordapp.com/preview.png',
            contentType: 'image/png',
            size: 12,
          },
          {
            name: 'alpha.pdf',
            url: 'https://cdn.discordapp.com/alpha.pdf',
            contentType: 'application/pdf',
            size: 20,
          },
          {
            name: 'beta.pdf',
            url: 'https://cdn.discordapp.com/beta.pdf',
            contentType: 'application/pdf',
            size: 24,
          },
          {
            name: 'gamma.pdf',
            url: 'https://cdn.discordapp.com/gamma.pdf',
            contentType: 'application/pdf',
            size: 28,
          },
        ]),
        first: vi.fn(() => null),
      },
    });

    await handleMessageCreate(message);

    expect(mockFetchAttachmentText).toHaveBeenCalledTimes(3);
    expect(mockFetchAttachmentText.mock.calls.map((call) => call[1])).toEqual([
      'alpha.pdf',
      'beta.pdf',
      'gamma.pdf',
    ]);
    expect(mockUpsertIngestedAttachment).not.toHaveBeenCalled();
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: expect.stringContaining('BEGIN FILE ATTACHMENT: gamma.pdf'),
      }),
    );

    const ingestPayload = mockIngestEvent.mock.calls[0]?.[0] as { content?: string };
    expect(ingestPayload.content).toContain(
      'Processed 3 attachment(s) for this turn. Persistent attachment cache is unavailable in this channel.',
    );
    expect(ingestPayload.content).not.toContain('Skipped 1 attachment(s) due to per-message limit');
  });

  it('queues uploaded image attachments for durable recall in logged channels', async () => {
    mockUpsertIngestedAttachment.mockResolvedValueOnce({ id: 'attachment-row-image' });

    const message = createMockMessage({
      content: 'random chat with image',
      channelId: 'channel-images',
      attachments: {
        values: vi.fn(() => [
          {
            name: 'meme.png',
            url: 'https://cdn.discordapp.com/meme.png',
            contentType: 'image/png',
            size: 1234,
          },
        ]),
        first: vi.fn(() => null),
      },
    });

    await handleMessageCreate(message);

    expect(mockFetchAttachmentText).not.toHaveBeenCalled();
    expect(mockUpsertIngestedAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: message.id,
        filename: 'meme.png',
        extractor: 'vision',
        status: 'queued',
        extractedText: null,
      }),
    );
    expect(mockQueueImageAttachmentRecall).toHaveBeenCalledTimes(1);

    const ingestPayload = mockIngestEvent.mock.calls[0]?.[0] as { content?: string };
    expect(ingestPayload.content).toContain('Attachment cache processed 1 attachment(s); cached attachments: 1.');
    expect(ingestPayload.content).toContain('attachment:attachment-row-image');
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
  });

  it('keeps cached image attachment references in runtime notes for invoked turns', async () => {
    mockUpsertIngestedAttachment.mockResolvedValueOnce({ id: 'attachment-row-image' });

    const message = createMockMessage({
      content: '<@123> what is this image?',
      channelId: 'channel-images',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      attachments: {
        values: vi.fn(() => [
          {
            name: 'scene.png',
            url: 'https://cdn.discordapp.com/scene.png',
            contentType: 'image/png',
            size: 2048,
          },
        ]),
        first: vi.fn(() => null),
      },
    });

    await handleMessageCreate(message);

    expect(mockQueueImageAttachmentRecall).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: expect.stringContaining('Attachments were cached.'),
      }),
    );
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: expect.stringContaining('attachment:attachment-row-image'),
      }),
    );
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
