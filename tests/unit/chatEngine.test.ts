import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mock Logger
vi.mock('../../src/core/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// 2. Mock Prisma
vi.mock('../../src/core/db/prisma-client', () => ({
  prisma: {
    userProfile: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    agentTrace: {
      create: vi.fn(),
      update: vi.fn(),
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
  LLM_PROVIDER: 'pollinations',
  PROFILE_UPDATE_INTERVAL: 1, // Ensure updates trigger immediately in tests
}));
vi.mock('../../src/config', () => ({
  config: mockConfig,
}));
vi.mock('../../src/core/config/legacy-config-adapter', () => ({
  config: mockConfig,
}));

// 5. Mock Profile Updater
const { mockUpdateProfile } = vi.hoisted(() => ({
  mockUpdateProfile: vi.fn().mockResolvedValue('Mocked New Summary'),
}));

vi.mock('../../src/core/memory/profileUpdater', () => ({
  updateProfileSummary: mockUpdateProfile,
}));

// 6. Mock Guild Settings Repo
const { mockGetGuildApiKey } = vi.hoisted(() => ({
  mockGetGuildApiKey: vi.fn().mockResolvedValue('test-api-key'),
}));

vi.mock('../../../src/core/agentRuntime/agent-trace-repo', () => ({
  upsertTraceStart: vi.fn().mockResolvedValue(undefined),
  updateTraceEnd: vi.fn().mockResolvedValue(undefined),
  replaceAgentRuns: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/core/settings/guildSettingsRepo', () => ({
  getGuildApiKey: mockGetGuildApiKey,
}));

vi.mock('../../src/core/orchestration/llmRouter', () => ({
  decideRoute: vi.fn().mockResolvedValue({ kind: 'simple', temperature: 0.7, experts: [], allowTools: true }),
}));

vi.mock('../../src/core/orchestration/runExperts', () => ({
  runExperts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/core/llm/model-resolver', () => ({
  resolveModelForRequest: vi.fn().mockResolvedValue('kimi'),
  resolveModelForRequestDetailed: vi.fn().mockResolvedValue({
    model: 'kimi',
    route: 'qa',
    requirements: {},
    allowlistApplied: false,
    candidates: ['kimi'],
    decisions: [{ model: 'kimi', accepted: true, reason: 'selected', healthScore: 0.5 }],
  }),
}));

import { generateChatReply } from '../../src/core/chat-engine';
import { prisma } from '../../src/core/db/prisma-client';

describe('ChatEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatFn.mockReset();
    mockConfig.LLM_PROVIDER = 'pollinations';
    // Default to returning a key so normal chat flow proceeds
    mockGetGuildApiKey.mockResolvedValue('test-api-key');
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
      guildId: 'guild1', // Changed from null to guild1
      messageId: 'msg1',
      userText: 'I like dark mode',
    });

    expect(mockUpdateProfile).toHaveBeenCalledWith({
      previousSummary: 'Old summary',
      userMessage: 'I like dark mode',
      assistantReply: 'Sure, updated.',
      channelId: 'chan1',
      guildId: 'guild1',
      userId: 'user1',
      apiKey: 'test-api-key', // Expect the mocked key
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


});
