import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Message, User, TextChannel } from 'discord.js';

// Hoist mocks
const { mockGenerateChatReply, mockClient, mockFetchAttachmentText } = vi.hoisted(() => {
  const mockGenerateChatReply = vi.fn();
  const mockClientUser = { id: 'bot-123', tag: 'SageBot#0001' } as any;
  const mockClient = { user: mockClientUser };
  const mockFetchAttachmentText = vi.fn();

  return { mockGenerateChatReply, mockClient, mockFetchAttachmentText };
});

// Mock chatEngine
vi.mock('../../../src/core/chat-engine', () => ({
  generateChatReply: mockGenerateChatReply,
}));

vi.mock('../../../src/core/utils/file-handler', () => ({
  fetchAttachmentText: mockFetchAttachmentText,
}));

// Mock safety
vi.mock('../../../src/core/safety', () => ({
  isRateLimited: vi.fn(() => false),
  isSeriousMode: vi.fn(() => false),
}));

// Mock logger
vi.mock('../../../src/core/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// Mock trace
vi.mock('../../../src/core/utils/trace-id-generator', () => ({
  generateTraceId: () => 'test-trace-id',
}));

// Mock client
vi.mock('../../../src/bot/client', () => ({
  client: mockClient,
}));

// Mock ingestEvent - let it pass through but track calls via logger.debug
// Mock ingestEvent
vi.mock('../../../src/core/ingest/ingestEvent', () => ({
  ingestEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/core/attachments/ingestedAttachmentRepo', () => ({
  upsertIngestedAttachment: vi.fn().mockResolvedValue(undefined),
}));

// Mock config to use manual autopilot mode (so non-mentions don't trigger AI)
vi.mock('../../../src/config', async () => {
  const actual = await vi.importActual<typeof import('../../../src/config')>('../../../src/config');
  return {
    ...actual,
    config: {
      ...actual.config,
      AUTOPILOT_MODE: 'manual',
      WAKE_WORDS_CSV: 'Sage',
      WAKE_WORD_PREFIXES_CSV: '',
      INGESTION_ENABLED: true,
      INGESTION_MODE: 'all',
    },
  };
});

import { handleMessageCreate } from '../../../src/bot/handlers/messageCreate';
import { resetInvocationCooldowns } from '../../../src/core/invocation/invocation-rate-limiter';
import { logger } from '../../../src/core/utils/logger';
import { ingestEvent } from '../../../src/core/ingest/ingestEvent';

describe('messageCreate - Ingest Flow', () => {
  let messageCounter = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateChatReply.mockResolvedValue({ replyText: 'Test response' });
    mockFetchAttachmentText.mockResolvedValue({
      kind: 'ok',
      text: 'default file text',
      extractor: 'tika',
      byteLength: 16,
      mimeType: 'text/plain',
    });
    resetInvocationCooldowns();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createMockMessage(overrides: Partial<Message> = {}): Message {
    messageCounter++;
    const baseMock = {
      id: `msg-${Date.now()}-${messageCounter}`, // Unique ID with timestamp
      content: 'Hello bot!',
      author: {
        id: 'user-456',
        bot: false,
        username: 'TestUser',
      } as User,
      member: {
        displayName: 'TestUser',
      },
      guildId: 'guild-789',
      channelId: 'channel-101',
      createdAt: new Date(),
      mentions: {
        has: vi.fn(() => false),
        users: new Map(),
      },
      reference: null,
      fetchReference: vi.fn(),
      attachments: {
        first: vi.fn(() => null),
      },
      channel: {
        send: vi.fn(),
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as unknown as TextChannel,
      ...overrides,
    } as unknown as Message;

    return baseMock;
  }

  it('should NOT call generateChatReply for non-mention messages', async () => {
    const message = createMockMessage({
      content: 'Regular message without mention',
    });

    await handleMessageCreate(message);

    // Verify ingestEvent was called
    expect(ingestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: message.id }),
    );

    // Verify generateChatReply was NOT called (message not a mention)
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
  });

  it('should call generateChatReply for wakeword requests', async () => {
    const message = createMockMessage({
      content: 'sage summarize what they are talking about',
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
  });

  it('should apply wakeword cooldown per user/channel', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    const firstMessage = createMockMessage({
      content: 'sage summarize this',
    });

    const secondMessage = createMockMessage({
      content: 'sage summarize again',
    });

    try {
      await handleMessageCreate(firstMessage);
      await handleMessageCreate(secondMessage);

      expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should ignore mid-sentence wakeword mentions', async () => {
    const message = createMockMessage({
      content: 'I met Sage yesterday at the park',
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).not.toHaveBeenCalled();
  });

  it('should call generateChatReply for mentions', async () => {
    const message = createMockMessage({
      content: '<@bot-123> Hello!',
      mentions: {
        has: vi.fn((user: User) => user.id === 'bot-123'),
      } as any,
    });

    await handleMessageCreate(message);

    // Verify ingestion happened
    expect(ingestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: message.id }),
    );

    // Verify generateChatReply WAS called (message is a mention)
    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
  });

  it('should treat replies as replies even when mentioning the bot', async () => {
    const message = createMockMessage({
      content: '<@bot-123> following up on your reply',
      mentions: {
        has: vi.fn((user: User) => user.id === 'bot-123'),
      } as any,
      reference: { messageId: 'ref-1' } as any,
      fetchReference: vi.fn().mockResolvedValue({
        author: { id: 'bot-123' },
        content: 'Prior bot message',
        attachments: {
          first: vi.fn(() => null),
        },
      }),
    });

    await handleMessageCreate(message);

    expect(message.fetchReference).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyToBotText: 'Prior bot message',
      }),
    );
  });

  it('should include reply reference content before the user message', async () => {
    const referencedMessage = {
      author: { id: 'user-999' },
      content: 'Original question',
      attachments: {
        first: vi.fn(() => null),
      },
      partial: false,
    } as unknown as Message;

    const message = createMockMessage({
      content: '<@bot-123> follow up',
      mentions: {
        has: vi.fn((user: User) => user.id === 'bot-123'),
      } as any,
      reference: { messageId: 'ref-2' } as any,
      referencedMessage,
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyReferenceContent: '[In reply to]: Original question',
      }),
    );
  });

  it('should include reply reference images as multimodal content', async () => {
    const referencedMessage = {
      author: { id: 'user-999' },
      content: '',
      attachments: {
        first: vi.fn(() => ({
          contentType: 'image/png',
          url: 'https://cdn.example.com/image.png',
        })),
      },
      partial: false,
    } as unknown as Message;

    const message = createMockMessage({
      content: '<@bot-123> what do you think?',
      mentions: {
        has: vi.fn((user: User) => user.id === 'bot-123'),
      } as any,
      reference: { messageId: 'ref-3' } as any,
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

  it('should skip bot messages without ingesting', async () => {
    const message = createMockMessage({
      author: {
        id: 'other-bot',
        bot: true,
      } as User,
    });

    await handleMessageCreate(message);

    // findthe call to logger.debug with event ingestion
    const ingestCallFound = vi.mocked(logger.debug).mock.calls.some((call) => {
      return call[1] === 'Event ingested';
    });

    expect(ingestCallFound).toBe(false);
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
  });

  it('should ingest non-mention messages even though bot does not reply', async () => {
    const message = createMockMessage({
      content: 'Just chatting without mentioning bot',
    });

    await handleMessageCreate(message);

    // Verify ingestion occurred
    expect(ingestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: message.id }),
    );

    // But no reply
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
  });

  it('should ingest and forward multiple non-image attachments', async () => {
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
      content: '<@bot-123> review these',
      channelId: 'channel-files',
      mentions: {
        has: vi.fn((user: User) => user.id === 'bot-123'),
      } as any,
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
      } as any,
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
    expect(ingestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Attachment cache processed 2 non-image attachment(s)'),
      }),
    );
    expect(ingestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.not.stringContaining('BEGIN FILE ATTACHMENT'),
      }),
    );
  });
});
