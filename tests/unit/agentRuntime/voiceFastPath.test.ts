import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockChat = vi.hoisted(() => ({
  chat: vi.fn(),
}));

vi.mock('../../../src/core/llm', () => ({
  getLLMClient: () => mockChat,
}));

vi.mock('../../../src/core/config/env', () => ({
  config: {
    llmProvider: 'pollinations',
    logLevel: 'error',
  },
}));

import { runChatTurn } from '../../../src/core/agentRuntime/agentRuntime';
import { applyChange, clearAll } from '../../../src/core/voice/voicePresenceIndex';

describe('voice fast-path queries', () => {
  beforeEach(() => {
    clearAll();
    mockChat.chat.mockClear();
  });

  it('answers who is in voice without calling the LLM', async () => {
    applyChange({
      guildId: 'guild-1',
      userId: 'user-1',
      displayName: 'User One',
      oldChannelId: null,
      newChannelId: 'channel-1',
      at: new Date('2026-01-18T10:00:00.000Z'),
    });

    const result = await runChatTurn({
      traceId: 'trace-1',
      userId: 'user-1',
      channelId: 'text-1',
      guildId: 'guild-1',
      messageId: 'msg-1',
      userText: "who's in voice?",
      userProfileSummary: null,
      replyToBotText: null,
    });

    expect(result.replyText).toContain('In voice right now');
    expect(result.replyText).toContain('<#channel-1>');
    expect(mockChat.chat).not.toHaveBeenCalled();
  });
});
