import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../src/config';
import { runChatTurn } from '../../../src/core/agentRuntime/agentRuntime';
import { createLLMClient, getLLMClient } from '../../../src/core/llm';

const mockDecideAgent = vi.hoisted(() => vi.fn());
const mockResolveModelForRequestDetailed = vi.hoisted(() => vi.fn());
const mockExecuteManagerWorkerPlan = vi.hoisted(() => vi.fn());
const mockAggregateManagerWorkerArtifacts = vi.hoisted(() => vi.fn());

vi.mock('../../../src/core/llm');
vi.mock('../../../src/core/llm/model-resolver', () => ({
  resolveModelForRequestDetailed: mockResolveModelForRequestDetailed,
  resolveModelForRequest: vi.fn().mockResolvedValue('openai-large'),
}));
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
vi.mock('../../../src/core/agentRuntime/workerExecutor', () => ({
  executeManagerWorkerPlan: mockExecuteManagerWorkerPlan,
}));
vi.mock('../../../src/core/agentRuntime/workerAggregator', () => ({
  aggregateManagerWorkerArtifacts: mockAggregateManagerWorkerArtifacts,
}));
vi.mock('../../../src/core/settings/guildSettingsRepo', () => ({
  getGuildApiKey: vi.fn().mockResolvedValue('test-key'),
}));

describe('Autopilot Runtime', () => {
  const mockLLM = {
    chat: vi.fn(),
  };
  const mockSearchLLM = {
    chat: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getLLMClient as unknown as { mockReturnValue: (value: unknown) => void }).mockReturnValue(
      mockLLM,
    );
    (createLLMClient as unknown as { mockReturnValue: (value: unknown) => void }).mockReturnValue(
      mockSearchLLM,
    );
    mockResolveModelForRequestDetailed.mockImplementation(
      async (params: { route?: string }) => {
        const route = (params.route ?? 'chat').toLowerCase();
        const model = route === 'search' ? 'gemini-search' : 'openai-large';
        return {
          model,
          route,
          requirements: {},
          allowlistApplied: false,
          candidates: [model],
          decisions: [{ model, accepted: true, reason: 'selected', healthScore: 0.8 }],
        };
      },
    );
    mockDecideAgent.mockResolvedValue({
      kind: 'chat',
      contextProviders: ['UserMemory'],
      temperature: 1.2,
      reasoningText: 'test decision',
    });
    mockExecuteManagerWorkerPlan.mockResolvedValue({
      plan: {
        routeKind: 'search',
        complexityScore: 0.8,
        rationale: ['search_complex_mode'],
        loops: 1,
        tasks: [],
      },
      artifacts: [],
      totalWorkers: 0,
      failedWorkers: 0,
    });
    mockAggregateManagerWorkerArtifacts.mockReturnValue({
      contextBlock: '',
      successfulWorkers: 0,
      failedWorkers: 0,
      citationCount: 0,
    });
    config.AGENTIC_MANAGER_WORKER_ENABLED = false;
    config.AGENTIC_MANAGER_WORKER_MAX_INPUT_CHARS = 32_000;
    config.AGENTIC_CANARY_ENABLED = true;
    config.AGENTIC_CANARY_ROUTE_ALLOWLIST_CSV = 'chat,coding,search,creative';
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

  it('returns raw search output for search_mode simple without chat summarization', async () => {
    mockDecideAgent.mockResolvedValue({
      kind: 'search',
      contextProviders: ['UserMemory'],
      temperature: 0.3,
      searchMode: 'simple',
      reasoningText: 'search simple route',
    });
    mockSearchLLM.chat.mockResolvedValue({
      content: 'Austin weather is 72F and sunny. source: weather.com',
    });

    const result = await runChatTurn({
      traceId: 'test-trace',
      userId: 'test-user',
      channelId: 'test-channel',
      guildId: 'test-guild',
      messageId: 'msg-1',
      userText: 'what is weather in austin now',
      userProfileSummary: null,
      replyToBotText: null,
      invokedBy: 'mention',
      isVoiceActive: true,
    });

    expect(result.replyText).toBe('Austin weather is 72F and sunny. source: weather.com');
    expect(mockLLM.chat).not.toHaveBeenCalled();
    const searchCall = mockSearchLLM.chat.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(searchCall.messages[0].role).toBe('system');
    expect(searchCall.messages[0].content).not.toContain('## Agentic State (JSON)');
  });

  it('retries guarded search models and keeps search allowlist strict', async () => {
    mockDecideAgent.mockResolvedValue({
      kind: 'search',
      contextProviders: ['UserMemory'],
      temperature: 0.3,
      searchMode: 'simple',
      reasoningText: 'search retry route',
    });
    mockResolveModelForRequestDetailed.mockImplementation(async (params: { route?: string }) => {
      const route = (params.route ?? 'chat').toLowerCase();
      if (route === 'search') {
        return {
          model: 'gemini-search',
          route,
          requirements: {},
          allowlistApplied: true,
          candidates: ['gemini-search', 'perplexity-fast', 'perplexity-reasoning', 'openai-large'],
          decisions: [{ model: 'gemini-search', accepted: true, reason: 'selected', healthScore: 0.8 }],
        };
      }
      return {
        model: 'openai-large',
        route,
        requirements: {},
        allowlistApplied: false,
        candidates: ['openai-large'],
        decisions: [{ model: 'openai-large', accepted: true, reason: 'selected', healthScore: 0.8 }],
      };
    });
    mockSearchLLM.chat
      .mockRejectedValueOnce(new Error('Pollinations Model Error: gemini-search failed'))
      .mockResolvedValueOnce({
        content:
          'Recovered via perplexity-fast with sources. ' +
          'Source URLs: https://example.com/a https://example.com/b ' +
          'Checked on: 2026-02-10',
      });

    const result = await runChatTurn({
      traceId: 'test-trace',
      userId: 'test-user',
      channelId: 'test-channel',
      guildId: 'test-guild',
      messageId: 'msg-1',
      userText: 'latest ai release updates',
      userProfileSummary: null,
      replyToBotText: null,
      invokedBy: 'mention',
      isVoiceActive: true,
    });

    expect(result.replyText).toBe(
      'Recovered via perplexity-fast with sources. ' +
      'Source URLs: https://example.com/a https://example.com/b ' +
      'Checked on: 2026-02-10',
    );
    expect(mockSearchLLM.chat).toHaveBeenCalledTimes(2);
    const firstAttempt = mockSearchLLM.chat.mock.calls[0]?.[0] as { model: string; timeout: number };
    const secondAttempt = mockSearchLLM.chat.mock.calls[1]?.[0] as { model: string; timeout: number };
    expect(firstAttempt.model).toBe('gemini-search');
    expect(secondAttempt.model).toBe('perplexity-fast');
    expect(firstAttempt.timeout).toBe(config.TIMEOUT_SEARCH_MS);
    expect(secondAttempt.timeout).toBe(config.TIMEOUT_SEARCH_MS);

    const searchResolveCall = mockResolveModelForRequestDetailed.mock.calls.find(
      (call: [{ route?: string; allowedModels?: string[] }]) => call[0]?.route === 'search',
    )?.[0];
    expect(searchResolveCall?.allowedModels).toEqual([
      'gemini-search',
      'perplexity-fast',
      'perplexity-reasoning',
    ]);
  });

  it('enables nomnom only when the user message contains a link', async () => {
    mockDecideAgent.mockResolvedValue({
      kind: 'search',
      contextProviders: ['UserMemory'],
      temperature: 0.3,
      searchMode: 'simple',
      reasoningText: 'search with direct link',
    });
    mockResolveModelForRequestDetailed.mockImplementation(async (params: { route?: string }) => {
      const route = (params.route ?? 'chat').toLowerCase();
      if (route === 'search') {
        return {
          model: 'gemini-search',
          route,
          requirements: {},
          allowlistApplied: true,
          candidates: ['gemini-search', 'perplexity-fast', 'perplexity-reasoning'],
          decisions: [{ model: 'gemini-search', accepted: true, reason: 'selected', healthScore: 0.8 }],
        };
      }
      return {
        model: 'openai-large',
        route,
        requirements: {},
        allowlistApplied: false,
        candidates: ['openai-large'],
        decisions: [{ model: 'openai-large', accepted: true, reason: 'selected', healthScore: 0.8 }],
      };
    });
    mockSearchLLM.chat.mockResolvedValue({
      content: 'Scraped and summarized page content.',
    });

    const result = await runChatTurn({
      traceId: 'test-trace',
      userId: 'test-user',
      channelId: 'test-channel',
      guildId: 'test-guild',
      messageId: 'msg-1',
      userText: 'summarize this link https://example.com/report',
      userProfileSummary: null,
      replyToBotText: null,
      invokedBy: 'mention',
      isVoiceActive: true,
    });

    expect(result.replyText).toBe('Scraped and summarized page content.');
    const firstAttempt = mockSearchLLM.chat.mock.calls[0]?.[0] as { model: string; timeout: number };
    expect(firstAttempt.model).toBe('nomnom');
    expect(firstAttempt.timeout).toBe(config.TIMEOUT_SEARCH_SCRAPER_MS);

    const searchResolveCall = mockResolveModelForRequestDetailed.mock.calls.find(
      (
        call: [
          {
            route?: string;
            allowedModels?: string[];
            featureFlags?: { search?: boolean; reasoning?: boolean; linkScrape?: boolean };
          },
        ],
      ) => call[0]?.route === 'search',
    )?.[0];
    expect(searchResolveCall?.allowedModels).toEqual([
      'gemini-search',
      'perplexity-fast',
      'perplexity-reasoning',
      'nomnom',
    ]);
    expect(searchResolveCall?.featureFlags?.search).toBe(true);
    expect(searchResolveCall?.featureFlags?.linkScrape).toBe(true);
  });

  it('runs chat summarization pass for search_mode complex', async () => {
    mockDecideAgent.mockResolvedValue({
      kind: 'search',
      contextProviders: ['UserMemory'],
      temperature: 0.3,
      searchMode: 'complex',
      reasoningText: 'search complex route',
    });
    mockSearchLLM.chat.mockResolvedValue({
      content:
        'Raw findings: Vendor A $499, Vendor B $529, Vendor C $479, mixed shipping and warranty data.',
    });
    mockLLM.chat.mockResolvedValue({
      content: 'Best value is Vendor C at $479 after shipping; Vendor A is second. Sources: vendor pages.',
    });

    const result = await runChatTurn({
      traceId: 'test-trace',
      userId: 'test-user',
      channelId: 'test-channel',
      guildId: 'test-guild',
      messageId: 'msg-1',
      userText: 'compare latest gpu prices and tell me best value',
      userProfileSummary: null,
      replyToBotText: null,
      invokedBy: 'mention',
      isVoiceActive: true,
    });

    expect(result.replyText).toBe(
      'Best value is Vendor C at $479 after shipping; Vendor A is second. Sources: vendor pages.',
    );
    expect(mockLLM.chat).toHaveBeenCalledTimes(1);
    const summaryRequest = mockLLM.chat.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(summaryRequest.messages).toHaveLength(2);
    expect(summaryRequest.messages[1].role).toBe('user');
    expect(summaryRequest.messages[1].content).toContain(
      'Search findings:\nRaw findings: Vendor A $499, Vendor B $529, Vendor C $479',
    );
    const usedRoutes = mockResolveModelForRequestDetailed.mock.calls.map(
      (call: [{ route?: string }]) => call[0]?.route,
    );
    expect(usedRoutes).toContain('search');
    expect(usedRoutes).toContain('chat');

    const searchResolve = mockResolveModelForRequestDetailed.mock.calls.find(
      (call: [{ route?: string; featureFlags?: { search?: boolean; reasoning?: boolean } }]) =>
        call[0]?.route === 'search',
    )?.[0];
    expect(searchResolve?.featureFlags?.search).toBe(true);
    expect(searchResolve?.featureFlags?.reasoning).toBeUndefined();

    const summaryResolve = mockResolveModelForRequestDetailed.mock.calls.find(
      (call: [{ route?: string; featureFlags?: { search?: boolean; reasoning?: boolean } }]) =>
        call[0]?.route === 'chat',
    )?.[0];
    expect(summaryResolve?.featureFlags).toBeUndefined();
  });

  it('keeps both head and tail of large search findings in complex summary handoff', async () => {
    mockDecideAgent.mockResolvedValue({
      kind: 'search',
      contextProviders: ['UserMemory'],
      temperature: 0.3,
      searchMode: 'complex',
      reasoningText: 'search complex route with large findings',
    });
    const tailMarker = 'TAIL_FINDING_VENDOR_Z';
    const longSearchFindings = `Lead findings start.\n${'A'.repeat(45_000)}\n${tailMarker}`;
    mockSearchLLM.chat.mockResolvedValue({
      content: longSearchFindings,
    });
    mockLLM.chat.mockResolvedValue({
      content: 'Synthesized result.',
    });

    await runChatTurn({
      traceId: 'test-trace',
      userId: 'test-user',
      channelId: 'test-channel',
      guildId: 'test-guild',
      messageId: 'msg-1',
      userText: 'compare latest gpu prices and tell me best value',
      userProfileSummary: null,
      replyToBotText: null,
      invokedBy: 'mention',
      isVoiceActive: true,
    });

    const summaryRequest = mockLLM.chat.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const summaryUserContent = summaryRequest.messages[1]?.content ?? '';
    expect(summaryUserContent).toContain('Search findings:\n');
    expect(summaryUserContent).toContain(tailMarker);
    expect(summaryUserContent).toContain('chars omitted');
  });

  it('injects runtime capability manifest into the system prompt', async () => {
    mockDecideAgent.mockResolvedValue({
      kind: 'chat',
      contextProviders: ['UserMemory', 'SocialGraph'],
      temperature: 1.2,
      reasoningText: 'capability manifest test',
    });
    mockLLM.chat.mockResolvedValue({ content: 'ok' });

    await runChatTurn({
      traceId: 'test-trace',
      userId: 'test-user',
      channelId: 'test-channel',
      guildId: 'test-guild',
      messageId: 'msg-1',
      userText: 'help me with today plan',
      userProfileSummary: null,
      replyToBotText: null,
      invokedBy: 'mention',
      isVoiceActive: true,
    });

    const firstCall = mockLLM.chat.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemMessage = firstCall.messages.find((message) => message.role === 'system');
    expect(systemMessage?.content).toContain('## Runtime Capabilities');
    expect(systemMessage?.content).toContain('Active route (selected by router for this turn): chat.');
    expect(systemMessage?.content).toContain('Router can choose these routes per turn: chat, coding, search, creative.');
    expect(systemMessage?.content).toContain('## Agentic State (JSON)');
    expect(systemMessage?.content).toContain('Never claim or imply capabilities');
    expect(systemMessage?.content).not.toContain('Tool protocol: if tool assistance is needed');
    expect(systemMessage?.content).not.toContain('Available tools:');
  });

  it('enforces UserMemory and ChannelMemory for chat when router provides partial providers', async () => {
    mockDecideAgent.mockResolvedValue({
      kind: 'chat',
      contextProviders: ['SocialGraph'],
      temperature: 1.2,
      reasoningText: 'provider enforcement test',
    });
    mockLLM.chat.mockResolvedValue({ content: 'ok' });

    await runChatTurn({
      traceId: 'test-trace',
      userId: 'test-user',
      channelId: 'test-channel',
      guildId: 'test-guild',
      messageId: 'msg-1',
      userText: 'help me plan the week',
      userProfileSummary: null,
      replyToBotText: null,
      invokedBy: 'mention',
      isVoiceActive: false,
    });

    const firstCall = mockLLM.chat.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemMessage = firstCall.messages.find((message) => message.role === 'system');
    expect(systemMessage?.content).toContain(
      'Context providers available this turn: UserMemory, ChannelMemory, SocialGraph.',
    );
  });

  it('skips manager-worker orchestration when canary disallows agentic', async () => {
    config.AGENTIC_MANAGER_WORKER_ENABLED = true;
    config.AGENTIC_CANARY_ROUTE_ALLOWLIST_CSV = 'chat';
    mockDecideAgent.mockResolvedValue({
      kind: 'search',
      contextProviders: ['UserMemory'],
      temperature: 0.3,
      searchMode: 'complex',
      reasoningText: 'manager worker canary skip',
    });
    mockSearchLLM.chat.mockResolvedValue({
      content: 'Raw findings from search phase.',
    });
    mockLLM.chat.mockResolvedValue({
      content: 'Final answer from summary phase.',
    });

    await runChatTurn({
      traceId: 'test-trace-canary-skip',
      userId: 'test-user',
      channelId: 'test-channel',
      guildId: 'test-guild',
      messageId: 'msg-1',
      userText: 'compare latest gpu prices across vendors',
      userProfileSummary: null,
      replyToBotText: null,
      invokedBy: 'mention',
      isVoiceActive: true,
    });

    expect(mockExecuteManagerWorkerPlan).not.toHaveBeenCalled();
  });

  it('passes configured worker input budget into manager-worker executor', async () => {
    config.AGENTIC_MANAGER_WORKER_ENABLED = true;
    config.AGENTIC_MANAGER_WORKER_MAX_INPUT_CHARS = 54_321;
    config.AGENTIC_CANARY_ROUTE_ALLOWLIST_CSV = 'chat,coding,search,creative';
    mockDecideAgent.mockResolvedValue({
      kind: 'search',
      contextProviders: ['UserMemory'],
      temperature: 0.3,
      searchMode: 'complex',
      reasoningText: 'manager worker config wiring',
    });
    mockExecuteManagerWorkerPlan.mockResolvedValue({
      plan: {
        routeKind: 'search',
        complexityScore: 0.9,
        rationale: ['search_complex_mode'],
        loops: 1,
        tasks: [
          {
            id: 'research-1',
            worker: 'research',
            objective: 'collect',
          },
        ],
      },
      artifacts: [
        {
          taskId: 'research-1',
          worker: 'research',
          objective: 'collect',
          model: 'gemini-search',
          summary: 'found facts',
          keyPoints: ['k1'],
          openQuestions: [],
          citations: ['https://example.com'],
          confidence: 0.8,
          latencyMs: 120,
          failed: false,
          rawText: '{}',
        },
      ],
      totalWorkers: 1,
      failedWorkers: 0,
    });
    mockAggregateManagerWorkerArtifacts.mockReturnValue({
      contextBlock: '## Manager-Worker Findings\n[research] found facts',
      successfulWorkers: 1,
      failedWorkers: 0,
      citationCount: 1,
    });
    mockSearchLLM.chat.mockResolvedValue({
      content: 'Raw findings from search phase.',
    });
    mockLLM.chat.mockResolvedValue({
      content: 'Final answer from summary phase.',
    });

    await runChatTurn({
      traceId: 'test-trace-manager-worker-budget',
      userId: 'test-user',
      channelId: 'test-channel',
      guildId: 'test-guild',
      messageId: 'msg-1',
      userText: 'compare latest sdk migration tradeoffs and verify edge cases',
      userProfileSummary: null,
      replyToBotText: null,
      invokedBy: 'mention',
      isVoiceActive: true,
    });

    expect(mockExecuteManagerWorkerPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        maxInputChars: 54_321,
      }),
    );
  });
});
