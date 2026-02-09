import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runChatTurn } from '../../../src/core/agentRuntime/agentRuntime';
import { getLLMClient } from '../../../src/core/llm';

const mockDecideAgent = vi.hoisted(() => vi.fn());

vi.mock('../../../src/core/llm');
vi.mock('../../../src/core/orchestration/agentSelector', () => ({
  decideAgent: mockDecideAgent,
}));
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
vi.mock('../../../src/core/agentRuntime/agent-trace-repo');
vi.mock('../../../src/core/settings/guildSettingsRepo', () => ({
  getGuildApiKey: vi.fn().mockResolvedValue('test-key'),
}));

describe('Autopilot Runtime', () => {
  const mockLLM = {
    chat: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getLLMClient as unknown as { mockReturnValue: (value: unknown) => void }).mockReturnValue(
      mockLLM,
    );
    mockDecideAgent.mockResolvedValue({
      kind: 'chat',
      contextProviders: ['Memory'],
      allowTools: true,
      temperature: 1.2,
      reasoningText: 'test decision',
    });
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

  it('should fallback to safe text when final draft is a tool_calls envelope', async () => {
    mockDecideAgent.mockResolvedValue({
      kind: 'chat',
      contextProviders: ['Memory'],
      allowTools: false,
      temperature: 1.2,
      reasoningText: 'disable tool protocol for direct text test',
    });
    mockLLM.chat.mockResolvedValue({
      content: JSON.stringify({
        type: 'tool_calls',
        calls: [{ name: 'verify_search_again', args: { reason: 'freshness' } }],
      }),
    });

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
      isVoiceActive: true,
    });

    expect(result.replyText).toBe(
      "I couldn't complete the final tool response cleanly. Please ask again and I'll retry with a direct answer.",
    );
  });
});
