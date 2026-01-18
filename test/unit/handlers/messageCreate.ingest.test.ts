import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Message, User, TextChannel } from 'discord.js';

// Hoist mocks
const { mockGenerateChatReply, mockClient } = vi.hoisted(() => {
    const mockGenerateChatReply = vi.fn();
    const mockClientUser = { id: 'bot-123', tag: 'SageBot#0001' } as any;
    const mockClient = { user: mockClientUser };

    return { mockGenerateChatReply, mockClient };
});

// Mock chatEngine
vi.mock('../../../src/core/chat/chatEngine', () => ({
    generateChatReply: mockGenerateChatReply,
}));

// Mock safety
vi.mock('../../../src/core/safety', () => ({
    isRateLimited: vi.fn(() => false),
    isSeriousMode: vi.fn(() => false),
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
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
vi.mock('../../../src/utils/trace', () => ({
    generateTraceId: () => 'test-trace-id',
}));

// Mock client
vi.mock('../../../src/bot/client', () => ({
    client: mockClient,
}));

// Mock ingestEvent - let it pass through but track calls via logger.debug
vi.mock('../../../src/core/ingest/ingestEvent', async () => {
    const actual = await vi.importActual<typeof import('../../../src/core/ingest/ingestEvent')>(
        '../../../src/core/ingest/ingestEvent',
    );
    return actual;
});

import { handleMessageCreate } from '../../../src/bot/handlers/messageCreate';
import { resetInvocationCooldowns } from '../../../src/core/invoke/cooldown';
import { logger } from '../../../src/utils/logger';

describe('messageCreate - Ingest Flow', () => {
    let messageCounter = 0;

    beforeEach(() => {
        vi.clearAllMocks();
        mockGenerateChatReply.mockResolvedValue({ replyText: 'Test response' });
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
            } as User,
            guildId: 'guild-789',
            channelId: 'channel-101',
            createdAt: new Date(),
            mentions: {
                has: vi.fn(() => false),
            },
            reference: null,
            fetchReference: vi.fn(),
            channel: {
                send: vi.fn(),
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

        // Verify logger.debug was called for ingestion
        expect(logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({ event: expect.objectContaining({ type: 'message' }) }),
            'Event ingested',
        );

        // Verify generateChatReply was NOT called (message not a mention)
        expect(mockGenerateChatReply).not.toHaveBeenCalled();
    });

    it('should call generateChatReply for wakeword requests', async () => {
        const message = createMockMessage({
            content: 'hey sage summarize what they are talking about',
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
        expect(logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({
                event: expect.objectContaining({
                    type: 'message',
                    mentionsBot: true,
                }),
            }),
            'Event ingested',
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
            }),
        });

        await handleMessageCreate(message);

        expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
        expect(mockGenerateChatReply).toHaveBeenCalledWith(
            expect.objectContaining({
                replyToBotText: 'Prior bot message',
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
        expect(logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({ event: expect.any(Object) }),
            'Event ingested',
        );

        // But no reply
        expect(mockGenerateChatReply).not.toHaveBeenCalled();
    });
});
