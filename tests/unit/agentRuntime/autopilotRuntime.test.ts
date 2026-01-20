import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runChatTurn } from '../../../src/core/agentRuntime/agentRuntime';
import { getLLMClient } from '../../../src/core/llm';

vi.mock('../../../src/core/llm');
vi.mock('../../../src/core/awareness/channelRingBuffer');
vi.mock('../../../src/core/awareness/transcriptBuilder');
vi.mock('../../../src/core/settings/guildChannelSettings', () => ({
  isLoggingEnabled: vi.fn().mockReturnValue(false),
}));
vi.mock('../../../src/core/utils/logger');
vi.mock('../../../src/core/orchestration/router', () => ({
  decideRoute: vi.fn().mockReturnValue({ kind: 'simple', temperature: 0.7, experts: [] }),
}));
vi.mock('../../../src/core/orchestration/runExperts', () => ({
  runExperts: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../src/core/orchestration/governor', () => ({
  governOutput: vi.fn().mockImplementation(async ({ draftText }) => ({
    finalText: draftText,
    actions: [],
  })),
}));
vi.mock('../../../src/core/trace/agentTraceRepo');

describe('Autopilot Runtime', () => {
  const mockLLM = {
    chat: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getLLMClient as unknown as { mockReturnValue: (value: unknown) => void }).mockReturnValue(
      mockLLM,
    );
  });

  it('should return empty string when LLM outputs [SILENCE]', async () => {
    mockLLM.chat.mockResolvedValue({ content: '[SILENCE]' });

    const result = await runChatTurn({
      traceId: 'test-trace',
      userId: 'test-user',
      channelId: 'test-channel',
      guildId: 'test-guild',
      messageId: 'msg-1',
      userText: 'Hello',
      userProfileSummary: null,
      replyToBotText: null,
      intent: 'autopilot',
      invokedBy: 'autopilot',
    });

    expect(result.replyText).toBe('');
    expect(mockLLM.chat).toHaveBeenCalled();
  });

  it('should return text when LLM outputs normal text', async () => {
    mockLLM.chat.mockResolvedValue({ content: 'Hello there!' });

    const result = await runChatTurn({
      traceId: 'test-trace',
      userId: 'test-user',
      channelId: 'test-channel',
      guildId: 'test-guild',
      messageId: 'msg-1',
      userText: 'Hello',
      userProfileSummary: null,
      replyToBotText: null,
      intent: 'autopilot',
      invokedBy: 'autopilot',
    });

    expect(result.replyText).toBe('Hello there!');
  });

  it('should treat whitespace with [SILENCE] as silence', async () => {
    mockLLM.chat.mockResolvedValue({ content: '  [SILENCE]  \n ' });

    const result = await runChatTurn({
      traceId: 'test-trace',
      userId: 'test-user',
      channelId: 'test-channel',
      guildId: 'test-guild',
      messageId: 'msg-1',
      userText: 'Hello',
      userProfileSummary: null,
      replyToBotText: null,
      intent: 'autopilot',
      invokedBy: 'autopilot',
    });

    expect(result.replyText).toBe('');
  });
});
