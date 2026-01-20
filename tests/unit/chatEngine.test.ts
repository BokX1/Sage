import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mock Logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
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

// 2. Mock Prisma
vi.mock('../../src/db/client', () => ({
  prisma: {
    userProfile: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

// 3. Mock LLM
const mockChatFn = vi.fn();
vi.mock('../../src/core/llm', () => ({
  getLLMClient: () => ({
    chat: mockChatFn,
  }),
}));

// 4. Mock Config (Mutable)
const mockConfig = vi.hoisted(() => ({
  llmProvider: 'pollinations',
}));
vi.mock('../../src/core/config/env', () => ({
  config: mockConfig,
}));

// 5. Mock Profile Updater
const { mockUpdateProfile } = vi.hoisted(() => ({
  mockUpdateProfile: vi.fn().mockResolvedValue('Mocked New Summary'),
}));

vi.mock('../../src/core/memory/profileUpdater', () => ({
  updateProfileSummary: mockUpdateProfile,
}));

import { generateChatReply } from '../../src/core/chat/chatEngine';
import { prisma } from '../../src/db/client';

describe('ChatEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatFn.mockReset();
    mockConfig.llmProvider = 'pollinations';
  });

  it('should generate a reply using the LLM', async () => {
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValueOnce(null);
    mockChatFn.mockResolvedValue({ content: 'Hello there!' });

    const result = await generateChatReply({
      traceId: 'test-trace',
      userId: 'user1',
      channelId: 'chan1',
      guildId: null,
      messageId: 'msg1',
      userText: 'Hi',
    });

    expect(result.replyText).toBe('Hello there!');
    expect(mockChatFn).toHaveBeenCalledTimes(1);
  });

  it('should inject personal memory into system prompt', async () => {
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValueOnce({
      userId: 'user1',
      summary: 'Likes cats',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockChatFn.mockResolvedValue({ content: 'Meow' });

    await generateChatReply({
      traceId: 'test',
      userId: 'u1',
      channelId: 'c1',
      guildId: null,
      messageId: 'm1',
      userText: 'Do I like pets?',
    });

    const chatCall = mockChatFn.mock.calls[0][0];
    // Memory is now coalesced into the first system message
    expect(chatCall.messages[0].content).toContain('Likes cats');
  });

  it('should trigger profile update in background', async () => {
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValueOnce({
      userId: 'user1',
      summary: 'Old summary',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockChatFn.mockResolvedValue({ content: 'Sure, updated.' });

    await generateChatReply({
      traceId: 'test',
      userId: 'user1',
      channelId: 'chan1',
      guildId: null,
      messageId: 'msg1',
      userText: 'I like dark mode',
    });

    expect(mockUpdateProfile).toHaveBeenCalledWith({
      previousSummary: 'Old summary',
      userMessage: 'I like dark mode',
      assistantReply: 'Sure, updated.',
    });

    // Wait for background promise
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(prisma.userProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user1' },
        update: { summary: 'Mocked New Summary' },
      }),
    );
  });

  it('should inject Google Search tool for Pollinations provider', async () => {
    mockConfig.llmProvider = 'pollinations';
    mockChatFn.mockResolvedValue({ content: 'Result' });

    await generateChatReply({
      traceId: 'trace',
      userId: 'u1',
      channelId: 'c1',
      guildId: null,
      messageId: 'm1',
      userText: 'Query',
    });

    const chatCall = mockChatFn.mock.calls[0][0];
    expect(chatCall.tools).toHaveLength(1);
    expect(chatCall.tools[0].function.name).toBe('google_search');
  });
});
