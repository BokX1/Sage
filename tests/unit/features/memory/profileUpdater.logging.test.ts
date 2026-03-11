import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentTurnContext } from '@/features/agent-runtime/continuityContext';
import { logger } from '@/platform/logging/logger';

const { mockChatFn, mockJsonRepair } = vi.hoisted(() => ({
  mockChatFn: vi.fn(),
  mockJsonRepair: vi.fn(),
}));

vi.mock('@/platform/llm', () => ({
  createLLMClient: () => ({
    chat: mockChatFn,
  }),
}));

vi.mock('@/platform/config/env', () => ({
  config: {
    PROFILE_PROVIDER: 'pollinations',
    PROFILE_CHAT_MODEL: 'deepseek',
    TIMEOUT_MEMORY_MS: 600000,
  },
}));

vi.mock('@/features/awareness/channelRingBuffer', () => ({
  getRecentMessages: vi.fn(() => []),
}));

vi.mock('@/features/awareness/transcriptBuilder', () => ({
  buildTranscriptBlock: vi.fn(() => ''),
}));

vi.mock('jsonrepair', () => ({
  jsonrepair: mockJsonRepair,
}));

import { updateProfileSummary } from '@/features/memory/profileUpdater';

function makeCurrentTurn(overrides: Partial<CurrentTurnContext> = {}): CurrentTurnContext {
  return {
    invokerUserId: 'U1',
    invokerDisplayName: 'User',
    messageId: 'msg-1',
    guildId: 'G1',
    channelId: 'C1',
    invokedBy: 'mention',
    mentionedUserIds: [],
    isDirectReply: false,
    replyTargetMessageId: null,
    replyTargetAuthorId: null,
    botUserId: 'B1',
    ...overrides,
  };
}

describe('profileUpdater logging hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatFn.mockReset();
    mockJsonRepair.mockReset();
  });

  it('logs only a bounded preview when parsing fails', async () => {
    mockChatFn.mockResolvedValueOnce({
      text: '{"summary": ',
    });
    mockJsonRepair.mockImplementation(() => {
      throw new Error('repair failed');
    });

    const result = await updateProfileSummary({
      previousSummary: 'Existing summary',
      userMessage: 'Hello',
      assistantReply: 'Hi',
      currentTurn: makeCurrentTurn(),
      channelId: 'C1',
      guildId: 'G1',
      userId: 'U1',
    });

    expect(result).toBe('Existing summary');

    const parseFailureCall = vi.mocked(logger.error).mock.calls.find(
      (call) => call[1] === 'Failed to parse and repair JSON',
    );
    expect(parseFailureCall).toBeTruthy();
    expect((parseFailureCall?.[0] as { textPreview?: string }).textPreview).toContain('{"summary":');
    expect((parseFailureCall?.[0] as { text?: string }).text).toBeUndefined();
  });
});
