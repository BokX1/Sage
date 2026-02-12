import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../src/config';
import { runChatTurn } from '../../../src/core/agentRuntime/agentRuntime';
import { registerDefaultAgenticTools } from '../../../src/core/agentRuntime/defaultTools';

const mockDecideAgent = vi.hoisted(() => vi.fn());
const mockResolveModelForRequestDetailed = vi.hoisted(() => vi.fn());
const mockRunToolCallLoop = vi.hoisted(() => vi.fn());
const mockGetLLMClient = vi.hoisted(() => vi.fn());
const mockCreateLLMClient = vi.hoisted(() => vi.fn());

const mockLLM = {
  chat: vi.fn(),
};

vi.mock('../../../src/core/llm', () => ({
  getLLMClient: mockGetLLMClient,
  createLLMClient: mockCreateLLMClient,
}));
vi.mock('../../../src/core/llm/model-resolver', () => ({
  resolveModelForRequestDetailed: mockResolveModelForRequestDetailed,
  resolveModelForRequest: vi.fn().mockResolvedValue('openai-large'),
}));
vi.mock('../../../src/core/orchestration/agentSelector', () => ({
  decideAgent: mockDecideAgent,
}));
vi.mock('../../../src/core/agentRuntime/toolCallLoop', () => ({
  runToolCallLoop: mockRunToolCallLoop,
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

describe('search complex tool orchestrator model', () => {
  beforeAll(() => {
    registerDefaultAgenticTools();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    config.AGENTIC_TOOL_LOOP_ENABLED = true;
    config.AGENTIC_TOOL_HARD_GATE_ENABLED = true;
    config.AGENTIC_TOOL_HARD_GATE_MIN_SUCCESSFUL_CALLS = 1;

    mockGetLLMClient.mockReturnValue(mockLLM);
    mockCreateLLMClient.mockReturnValue(mockLLM);
    mockDecideAgent.mockResolvedValue({
      kind: 'search',
      contextProviders: ['UserMemory'],
      temperature: 0.3,
      searchMode: 'complex',
      reasoningText: 'complex search orchestrator test',
    });
    mockResolveModelForRequestDetailed.mockResolvedValue({
      model: 'openai-large',
      route: 'chat',
      requirements: {},
      allowlistApplied: false,
      candidates: ['openai-large'],
      decisions: [{ model: 'openai-large', accepted: true, reason: 'selected', healthScore: 0.9 }],
    });
    mockRunToolCallLoop.mockResolvedValue({
      replyText:
        'Tool findings.\nSource URLs: https://example.com/a https://example.com/b\nChecked on: 2026-02-12',
      toolsExecuted: true,
      roundsCompleted: 1,
      toolResults: [
        { name: 'web_search', success: true, result: { sourceUrls: ['https://example.com/a'] }, latencyMs: 8 },
      ],
      policyDecisions: [],
    });
    mockLLM.chat
      .mockResolvedValueOnce({
        content: '{"type":"tool_calls","calls":[{"name":"web_search","args":{"query":"latest sdk"}}]}',
      })
      .mockResolvedValueOnce({
        content:
          'Answer: Final synthesis.\nSource URLs: https://example.com/a https://example.com/b\nChecked on: 2026-02-12',
      });
  });

  it('uses openai-large for complex search tool orchestration', async () => {
    const result = await runChatTurn({
      traceId: 'trace-search-complex-tool-model',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-1',
      userText: 'compare latest sdk migration tradeoffs and summarize',
      userProfileSummary: null,
      replyToBotText: null,
      invokedBy: 'mention',
      isVoiceActive: true,
    });

    expect(result.replyText).toContain('Answer: Final synthesis.');
    expect(mockRunToolCallLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openai-large',
        ctx: expect.objectContaining({
          routeKind: 'search',
          searchMode: 'complex',
          toolExecutionProfile: 'search_complex',
        }),
      }),
    );
    expect(mockLLM.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openai-large',
      }),
    );
  });
});
