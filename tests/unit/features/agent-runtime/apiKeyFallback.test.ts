import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { CurrentTurnContext } from '@/features/agent-runtime/continuityContext';

const mockConfig = vi.hoisted(() => ({
  AI_PROVIDER_API_KEY: 'env-key',
  SAGE_TRACE_DB_ENABLED: false,
  LANGSMITH_TRACING: false,
  TIMEOUT_CHAT_MS: 1000,
  AI_PROVIDER_MAIN_AGENT_MODEL: 'test-main-agent-model',
  SERVER_PROVIDER_AUTHORIZE_URL:
    'https://server-provider.example/authorize?redirect_url=https://server-provider.example&permissions=profile,balance,usage',
  SERVER_PROVIDER_PROFILE_URL: 'https://server-provider.example/account/profile',
  SERVER_PROVIDER_DASHBOARD_URL: 'https://server-provider.example/dashboard',
  CHAT_MAX_OUTPUT_TOKENS: 800,
  AGENT_GRAPH_MAX_OUTPUT_TOKENS: 800,
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: 5,
  AUTOPILOT_MODE: null,
}));

const mockResolveTextProviderRoute = vi.hoisted(() => vi.fn());
const mockGetGuildSagePersonaText = vi.hoisted(() => vi.fn());
const mockRunAgentGraphTurn = vi.hoisted(() => vi.fn());
const mockBuildPromptContextMessages = vi.hoisted(() => vi.fn());
const globalToolRegistryMock = vi.hoisted(() => ({
  listNames: vi.fn(() => []),
  get: vi.fn(() => undefined),
}));

vi.mock('@/platform/config/env', () => ({
  config: mockConfig,
}));

vi.mock('@/features/awareness/channelRingBuffer', () => ({
  getRecentMessages: vi.fn().mockReturnValue([]),
}));

vi.mock('@/features/awareness/transcriptBuilder', () => ({
  buildTranscriptBlock: vi.fn().mockReturnValue(null),
}));

vi.mock('@/features/agent-runtime/promptContract', () => ({
  buildPromptContextMessages: mockBuildPromptContextMessages,
}));

vi.mock('@/features/settings/guildChannelSettings', () => ({
  isLoggingEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/features/agent-runtime/agent-trace-repo', () => ({
  upsertTraceStart: vi.fn(),
  updateTraceEnd: vi.fn(),
}));

vi.mock('@/features/agent-runtime/langgraph/runtime', () => ({
  runAgentGraphTurn: mockRunAgentGraphTurn,
  resumeAgentGraphTurn: vi.fn(),
}));

vi.mock('@/features/agent-runtime/apiKeyResolver', () => ({
  resolveTextProviderRoute: mockResolveTextProviderRoute,
}));

vi.mock('@/features/settings/guildSagePersonaRepo', () => ({
  getGuildSagePersonaText: mockGetGuildSagePersonaText,
}));

vi.mock('@/features/agent-runtime/toolRegistry', () => ({
  globalToolRegistry: globalToolRegistryMock,
}));

import { runChatTurn as runChatTurnImpl } from '@/features/agent-runtime/agentRuntime';

type RoutedParam<T> = Omit<T, 'originChannelId' | 'responseChannelId'> & {
  channelId?: string;
  originChannelId?: string;
  responseChannelId?: string;
};

function withRouting<T extends { originChannelId: string; responseChannelId: string }>(
  params: RoutedParam<T>,
): T {
  const responseChannelId = params.responseChannelId ?? params.channelId ?? 'channel-1';
  const originChannelId = params.originChannelId ?? params.channelId ?? responseChannelId;
  return {
    ...params,
    originChannelId,
    responseChannelId,
  } as T;
}

const runChatTurn = (params: RoutedParam<Parameters<typeof runChatTurnImpl>[0]>) =>
  runChatTurnImpl(withRouting(params));

function makeCurrentTurn(
  overrides: Partial<CurrentTurnContext> & { channelId?: string } = {},
): CurrentTurnContext {
  const responseChannelId = overrides.responseChannelId ?? overrides.channelId ?? 'channel-1';
  const originChannelId = overrides.originChannelId ?? overrides.channelId ?? responseChannelId;
  return {
    invokerUserId: 'user-1',
    invokerDisplayName: 'User One',
    messageId: 'msg-1',
    guildId: 'guild-1',
    originChannelId,
    responseChannelId,
    invokedBy: 'mention',
    mentionedUserIds: [],
    isDirectReply: false,
    replyTargetMessageId: null,
    replyTargetAuthorId: null,
    botUserId: 'sage-bot',
    ...overrides,
  };
}

function makeGraphResult(overrides: Partial<Awaited<ReturnType<typeof mockRunAgentGraphTurn>>> = {}) {
  return {
    replyText: 'ok',
    toolResults: [],
    files: [],
    roundsCompleted: 0,
    completedWindows: 0,
    totalRoundsCompleted: 0,
    deduplicatedCallCount: 0,
    roundEvents: [],
    finalization: {
      attempted: false,
      succeeded: true,
      completedAt: '2026-03-12T00:00:00.000Z',
      stopReason: 'verified_closeout',
      completionKind: 'final_answer',
      deliveryDisposition: 'chat_reply',
      protocolRepairCount: 0,
      protocolRepairInstruction: null,
      toolDeliveredFinal: false,
    },
    completionKind: 'final_answer',
    stopReason: 'verified_closeout',
    deliveryDisposition: 'chat_reply',
    protocolRepairCount: 0,
    protocolRepairInstruction: null,
    toolDeliveredFinal: false,
    contextFrame: {
      objective: 'Finish the request.',
      verifiedFacts: [],
      completedActions: [],
      openQuestions: [],
      pendingApprovals: [],
      deliveryState: 'none',
      nextAction: 'Close the turn.',
    },
    graphStatus: 'completed',
    pendingInterrupt: null,
    interruptResolution: null,
    langSmithRunId: null,
    langSmithTraceId: null,
    ...overrides,
  };
}

describe('agent runtime provider fallback', () => {
  beforeEach(() => {
    mockConfig.AI_PROVIDER_API_KEY = 'env-key';
    mockConfig.SERVER_PROVIDER_AUTHORIZE_URL =
      'https://server-provider.example/authorize?redirect_url=https://server-provider.example&permissions=profile,balance,usage';
    mockConfig.SERVER_PROVIDER_PROFILE_URL = 'https://server-provider.example/account/profile';
    mockConfig.SERVER_PROVIDER_DASHBOARD_URL = 'https://server-provider.example/dashboard';
    mockGetGuildSagePersonaText.mockResolvedValue(null);
    mockRunAgentGraphTurn.mockReset();
    mockBuildPromptContextMessages.mockReset();
    mockBuildPromptContextMessages.mockReturnValue({
      version: 'test-prompt-v1',
      systemMessage: 'sys',
      workingMemoryFrame: {
        objective: 'Finish the request.',
        verifiedFacts: [],
        completedActions: [],
        openQuestions: [],
        pendingApprovals: [],
        deliveryState: 'none',
        nextAction: 'Close the turn.',
      },
      promptFingerprint: 'fingerprint-1',
      messages: [
        new SystemMessage({ content: 'sys' }),
        new HumanMessage({ content: 'hello' }),
      ],
    });
    globalToolRegistryMock.listNames.mockReturnValue([]);
    globalToolRegistryMock.get.mockReturnValue(undefined);
    mockResolveTextProviderRoute.mockReset().mockResolvedValue({
      providerId: 'default',
      lane: 'main',
      baseUrl: 'https://fallback.example/v1',
      model: 'test-main-agent-model',
      apiKey: 'env-key',
      authSource: 'host_api_key',
    });
  });

  it('uses the fallback provider route when Codex is unavailable', async () => {
    mockRunAgentGraphTurn.mockResolvedValueOnce(makeGraphResult({ replyText: 'ok' }));

    const result = await runChatTurn({
      traceId: 'trace-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-1',
      userText: 'Hello',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn(),
    });

    expect(result.replyText).toBe('ok');
    expect(mockRunAgentGraphTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'default',
        baseUrl: 'https://fallback.example/v1',
        model: 'test-main-agent-model',
        apiKey: 'env-key',
      }),
    );
  }, 15_000);

  it('returns setup guidance when no route credentials are available', async () => {
    mockConfig.AI_PROVIDER_API_KEY = '';
    mockResolveTextProviderRoute.mockResolvedValueOnce({
      providerId: 'default',
      lane: 'main',
      baseUrl: 'https://fallback.example/v1',
      model: 'test-main-agent-model',
    });

    const result = await runChatTurn({
      traceId: 'trace-2',
      userId: 'user-2',
      channelId: 'channel-2',
      guildId: 'guild-2',
      messageId: 'msg-2',
      userText: 'Hello',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        invokerUserId: 'user-2',
        invokerDisplayName: 'User Two',
        messageId: 'msg-2',
        guildId: 'guild-2',
        channelId: 'channel-2',
      }),
    });

    expect(result.replyText).toBe(
      "I'm not set up to chat in this server yet, so please ask the bot operator to run `npm run auth:codex:login` or add the AI provider key.",
    );
    expect(result.meta).toEqual({
      kind: 'missing_api_key',
      missingApiKey: {
        recovery: 'host_api_key',
      },
    });
    expect(mockRunAgentGraphTurn).not.toHaveBeenCalled();
  });

  it('returns hosted activation guidance when the fallback flow points at Pollinations', async () => {
    mockConfig.AI_PROVIDER_API_KEY = '';
    mockConfig.SERVER_PROVIDER_AUTHORIZE_URL =
      'https://enter.pollinations.ai/authorize?redirect_url=https://pollinations.ai/&permissions=profile,balance,usage';
    mockConfig.SERVER_PROVIDER_PROFILE_URL = 'https://gen.pollinations.ai/account/profile';
    mockConfig.SERVER_PROVIDER_DASHBOARD_URL = 'https://enter.pollinations.ai/dashboard';
    mockResolveTextProviderRoute.mockResolvedValueOnce({
      providerId: 'default',
      lane: 'main',
      baseUrl: 'https://fallback.example/v1',
      model: 'test-main-agent-model',
    });

    const result = await runChatTurn({
      traceId: 'trace-3',
      userId: 'user-3',
      channelId: 'channel-3',
      guildId: 'guild-3',
      messageId: 'msg-3',
      userText: 'Hello',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        invokerUserId: 'user-3',
        invokerDisplayName: 'User Three',
        messageId: 'msg-3',
        guildId: 'guild-3',
        channelId: 'channel-3',
      }),
    });

    expect(result.replyText).toBe("I'm not set up in this server yet, so please ask a server admin to activate me.");
    expect(result.meta).toEqual({
      kind: 'missing_api_key',
      missingApiKey: {
        recovery: 'server_key_activation',
      },
    });
    expect(mockRunAgentGraphTurn).not.toHaveBeenCalled();
  });

  it('prefers the Codex provider route when host Codex auth is available', async () => {
    mockRunAgentGraphTurn.mockResolvedValueOnce(makeGraphResult({ replyText: 'ok' }));
    mockResolveTextProviderRoute.mockResolvedValueOnce({
      providerId: 'openai_codex',
      lane: 'main',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      apiKey: 'codex-oauth-token',
      authSource: 'host_codex_auth',
      fallbackRoute: {
        providerId: 'default',
        baseUrl: 'https://fallback.example/v1',
        model: 'test-main-agent-model',
        apiKey: 'env-key',
        authSource: 'host_api_key',
      },
    });

    const result = await runChatTurn({
      traceId: 'trace-4',
      userId: 'user-4',
      channelId: 'channel-4',
      guildId: 'guild-4',
      messageId: 'msg-4',
      userText: 'Hello',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        invokerUserId: 'user-4',
        invokerDisplayName: 'User Four',
        messageId: 'msg-4',
        guildId: 'guild-4',
        channelId: 'channel-4',
      }),
    });

    expect(result.replyText).toBe('ok');
    expect(mockRunAgentGraphTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai_codex',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4',
        apiKey: 'codex-oauth-token',
      }),
    );
  });
});

