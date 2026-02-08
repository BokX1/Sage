import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runChatTurn } from '../../../src/core/agentRuntime/agentRuntime';
import { getLLMClient } from '../../../src/core/llm';
import { getGuildApiKey } from '../../../src/core/settings/guildSettingsRepo';
import { getWelcomeMessage } from '../../../src/bot/handlers/welcomeMessage';

const mockConfig = vi.hoisted(() => ({
  LLM_API_KEY: 'env-key',
  TRACE_ENABLED: false,
  TIMEOUT_CHAT_MS: 1000,
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: 5,
  CONTEXT_TRANSCRIPT_MAX_CHARS: 2000,
  SUMMARY_ROLLING_WINDOW_MIN: 60,
  RELATIONSHIP_HINTS_MAX_EDGES: 5,
}));

vi.mock('../../../src/config', () => ({
  config: mockConfig,
}));

vi.mock('../../../src/core/llm');
vi.mock('../../../src/core/config/legacy-config-adapter', () => ({
  config: {
    llmProvider: 'pollinations',
    logLevel: 'error',
  },
}));
vi.mock('../../../src/core/awareness/channelRingBuffer', () => ({
  getRecentMessages: vi.fn(),
}));
vi.mock('../../../src/core/awareness/transcriptBuilder', () => ({
  buildTranscriptBlock: vi.fn(),
}));
vi.mock('../../../src/core/settings/guildChannelSettings', () => ({
  isLoggingEnabled: vi.fn().mockReturnValue(false),
}));
vi.mock('../../../src/core/summary/channelSummaryStoreRegistry', () => ({
  getChannelSummaryStore: vi.fn(),
}));
vi.mock('../../../src/core/orchestration/llmRouter', () => ({
  decideRoute: vi.fn().mockResolvedValue({
    kind: 'qa',
    experts: [],
    allowTools: false,
    temperature: 0.7,
  }),
}));
vi.mock('../../../src/core/orchestration/runExperts', () => ({
  runExperts: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../src/core/llm/model-resolver', () => ({
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
vi.mock('../../../src/core/utils/logger');
vi.mock('../../../src/core/agentRuntime/agent-trace-repo', () => ({
  upsertTraceStart: vi.fn(),
  updateTraceEnd: vi.fn(),
  replaceAgentRuns: vi.fn(),
}));
vi.mock('../../../src/core/settings/guildSettingsRepo', () => ({
  getGuildApiKey: vi.fn(),
}));
vi.mock('../../../src/bot/handlers/welcomeMessage', () => ({
  getWelcomeMessage: vi.fn().mockReturnValue('welcome'),
}));
vi.mock('../../../src/core/agentRuntime/contextBuilder', () => ({
  buildContextMessages: vi.fn().mockReturnValue([{ role: 'user', content: 'Hello' }]),
}));

describe('agent runtime API key fallback', () => {
  const mockLLM = {
    chat: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.LLM_API_KEY = 'env-key';
    (getLLMClient as unknown as { mockReturnValue: (value: unknown) => void }).mockReturnValue(
      mockLLM,
    );
  });

  it('uses the global API key when no guild key is configured', async () => {
    mockLLM.chat.mockResolvedValue({ content: 'ok' });
    vi.mocked(getGuildApiKey).mockResolvedValue(undefined);

    const result = await runChatTurn({
      traceId: 'trace-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-1',
      userText: 'Hello',
      userProfileSummary: null,
      replyToBotText: null,
    });

    expect(result.replyText).toBe('ok');
    expect(getWelcomeMessage).not.toHaveBeenCalled();
    expect(mockLLM.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'env-key',
      }),
    );
  });

  it('returns the welcome message when no keys are available', async () => {
    mockConfig.LLM_API_KEY = '';
    vi.mocked(getGuildApiKey).mockResolvedValue(undefined);

    const result = await runChatTurn({
      traceId: 'trace-2',
      userId: 'user-2',
      channelId: 'channel-2',
      guildId: 'guild-2',
      messageId: 'msg-2',
      userText: 'Hello',
      userProfileSummary: null,
      replyToBotText: null,
    });

    expect(result.replyText).toBe('welcome');
    expect(mockLLM.chat).not.toHaveBeenCalled();
  });
});
