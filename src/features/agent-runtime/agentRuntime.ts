import { config as appConfig } from '../../platform/config/env';
import { getRecentMessages } from '../awareness/channelRingBuffer';
import { buildTranscriptBlock } from '../awareness/transcriptBuilder';
import { LLMChatMessage, LLMMessageContent } from '../../platform/llm/llm-types';
import { getGuildApiKey } from '../settings/guildSettingsRepo';
import { getGuildSagePersonaText } from '../settings/guildSagePersonaRepo';
import { isLoggingEnabled } from '../settings/guildChannelSettings';
import { logger } from '../../platform/logging/logger';
import { normalizeStrictlyPositiveInt } from '../../shared/utils/numbers';
import { upsertTraceStart, updateTraceEnd } from './agent-trace-repo';
import { buildContextMessages } from './contextBuilder';
import { clearGitHubFileLookupCacheForTrace } from './toolIntegrations';
import { enforceGitHubFileGrounding } from './toolGrounding';
import { buildAgentGraphConfig } from './langgraph/config';
import { runAgentGraphTurn } from './langgraph/runtime';
import { scrubFinalReplyText } from './finalReplyScrubber';

import {
  buildCapabilityPromptSection,
  type BuildCapabilityPromptSectionParams,
} from './capabilityPrompt';
import {
  CurrentTurnContext,
  ReplyTargetContext,
  selectFocusedContinuityMessages,
} from './continuityContext';
import { resolveRuntimeAutopilotMode } from './autopilotMode';
import { globalToolRegistry } from './toolRegistry';
import type { ToolResult } from './toolCallExecution';

import { formatLiveVoiceContext } from '../voice/voiceConversationSessionStore';

const SINGLE_ROUTE_KIND = 'single';

/** Default model identifier when CHAT_MODEL is not configured. */
const DEFAULT_CHAT_MODEL = 'kimi';

export interface RunChatTurnParams {
  traceId: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  voiceChannelId?: string | null;
  messageId: string;
  userText: string;
  userContent?: LLMMessageContent;
  userProfileSummary: string | null;
  currentTurn: CurrentTurnContext;
  replyTarget?: ReplyTargetContext | null;
  mentionedUserIds?: string[];
  invokedBy?: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';
  isVoiceActive?: boolean;
  isAdmin?: boolean;
}

export interface RunChatTurnResult {
  replyText: string;
  meta?: {
    kind?: 'missing_api_key';
  };
  debug?: {
    messages?: LLMChatMessage[];
  };
  files?: Array<{
    attachment: Buffer;
    name: string;
  }>;
}

function buildToolUsageInstruction(toolNames: string[]): string {
  if (toolNames.length === 0) return '';

  const lines = [
    '<tool_usage>',
    'When you need tools, use the provider-native tool calling interface directly.',
    'Do not describe, serialize, or wrap tool calls in JSON or markdown.',
    'Do not narrate tool names, tool arguments, approval payloads, or retry protocol in the channel reply.',
    'After gathering sufficient data, either respond in plain text or use the appropriate Discord self-send action when the runtime guidance tells you to deliver the final answer through Discord.',
    'If no tool is needed, answer normally in plain text.',
    '',
    'Behavioral rules (batching, tool selection, guardrails) are in <execution_rules> and <tool_selection_guide>.',
    '</tool_usage>',
  ];

  return lines.join('\n');
}

function resolveActiveToolNames(params: {
  isAdmin: boolean;
  invokedBy: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';
}): string[] {
  const allToolNames = globalToolRegistry.listNames();
  return allToolNames.filter((toolName) => {
    const tool = globalToolRegistry.get(toolName);
    if (!tool) return false;
    const access = tool.metadata?.access ?? 'public';
    if (access === 'public') return true;
    return params.isAdmin && params.invokedBy !== 'autopilot';
  });
}

export async function runChatTurn(params: RunChatTurnParams): Promise<RunChatTurnResult> {
  const {
    traceId,
    userId,
    channelId,
    guildId,
    voiceChannelId,
    userText,
    userContent,
    currentTurn,
    replyTarget,
    invokedBy = 'mention',
    isVoiceActive,
    isAdmin = false,
  } = params;
  const clearToolCaches = () => {
    clearGitHubFileLookupCacheForTrace(traceId);
  };

  const recentMessages =
    guildId && isLoggingEnabled(guildId, channelId)
      ? getRecentMessages({ guildId, channelId, limit: appConfig.CONTEXT_TRANSCRIPT_MAX_MESSAGES })
      : [];

  const excludedAmbientMessageIds = [params.messageId];
  if (replyTarget?.messageId) {
    excludedAmbientMessageIds.push(replyTarget.messageId);
  }

  const focusedContinuityMessages = selectFocusedContinuityMessages({
    messages: recentMessages,
    currentTurn,
    replyTarget,
    excludedMessageIds: excludedAmbientMessageIds,
  });

  const focusedContinuityBlock =
    focusedContinuityMessages.length > 0
      ? buildTranscriptBlock(focusedContinuityMessages, appConfig.CONTEXT_TRANSCRIPT_MAX_CHARS, {
          header:
            'Focused continuity window (most recent last). Use this first for same-speaker or reply-chain continuity before reading ambient room context:',
          focusUserId: currentTurn.invokerUserId,
          sageUserId: currentTurn.botUserId ?? null,
        })
      : null;

  const transcriptBlock =
    recentMessages.length > 0
      ? buildTranscriptBlock(recentMessages, appConfig.CONTEXT_TRANSCRIPT_MAX_CHARS, {
          excludedMessageIds: excludedAmbientMessageIds,
          focusUserId: currentTurn.invokerUserId,
          sageUserId: currentTurn.botUserId ?? null,
        })
      : null;

  const liveVoiceContext =
    guildId && isVoiceActive && voiceChannelId
      ? formatLiveVoiceContext({ guildId, voiceChannelId, now: new Date() })
      : null;

  const guildApiKey = guildId ? await getGuildApiKey(guildId) : undefined;
  const apiKey = (guildApiKey ?? appConfig.LLM_API_KEY)?.trim();
  if (!apiKey) {
    logger.warn(
      { guildId, channelId, userId },
      'No API key configured for chat turn; returning setup guidance response',
    );
    clearToolCaches();
    return {
      replyText: guildId
        ? '⚠️ I need a server API key before I can respond here.'
        : '⚠️ I need an API key before I can respond. Configure `LLM_API_KEY` for this bot instance.',
      meta: guildId ? { kind: 'missing_api_key' } : undefined,
    };
  }

  let guildSagePersona: string | null = null;
  if (guildId) {
    try {
      guildSagePersona = await getGuildSagePersonaText(guildId);
    } catch (error) {
      logger.warn({ error, guildId }, 'Failed to load guild Sage Persona (non-fatal)');
    }
  }
  const model = (appConfig.CHAT_MODEL || DEFAULT_CHAT_MODEL).trim();
  const graphConfig = buildAgentGraphConfig();
  const graphLimits = {
    maxRounds: graphConfig.maxSteps,
    maxCallsPerRound: graphConfig.maxToolCallsPerStep,
    parallelReadOnlyTools: graphConfig.parallelReadOnlyTools,
    maxParallelReadOnlyTools: graphConfig.maxParallelReadOnlyTools,
  };
  const autopilotMode = resolveRuntimeAutopilotMode({
    invokedBy,
    configuredMode: appConfig.AUTOPILOT_MODE,
  });

  const activeToolNames = resolveActiveToolNames({ isAdmin, invokedBy });
  const capabilityParams: BuildCapabilityPromptSectionParams = {
    activeTools: activeToolNames,
    model,
    invokedBy,
    invokerIsAdmin: isAdmin,
    inGuild: guildId !== null,
    turnMode: isVoiceActive ? 'voice' : 'text',
    autopilotMode,
    graphLimits,
  };

  const runtimeInstruction = [
    buildCapabilityPromptSection(capabilityParams),
    buildToolUsageInstruction(activeToolNames),
  ].join('\n\n');

  const runtimeMessages = buildContextMessages({
    userProfileSummary: params.userProfileSummary,
    currentTurn,
    runtimeInstruction,
    guildSagePersona,
    replyTarget,
    userText,
    userContent,
    focusedContinuity: focusedContinuityBlock,
    recentTranscript: transcriptBlock,
    voiceContext: liveVoiceContext,
    invokedBy,
    isVoiceActive,
  });

  if (appConfig.TRACE_ENABLED) {
    try {
      await upsertTraceStart({
        id: traceId,
        guildId,
        channelId,
        userId,
        routeKind: SINGLE_ROUTE_KIND,
        tokenJson: {
          model,
          route: SINGLE_ROUTE_KIND,
          activeToolNames,
        },
        budgetJson: {
          route: SINGLE_ROUTE_KIND,
          model,
          graphEnabled: activeToolNames.length > 0,
        },
        threadId: traceId,
        graphStatus: 'running',
        agentEventsJson: [
          {
            type: 'runtime_start',
            route: SINGLE_ROUTE_KIND,
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      logger.warn({ error, traceId }, 'Failed to persist trace start');
    }
  }

  let graphBudgetJson: Record<string, unknown> | undefined;
  let toolResults: ToolResult[] = [];
  let graphTraceEvents: Record<string, unknown>[] = [];
  let finalReplyText: string;
  let files: Array<{ attachment: Buffer; name: string }> = [];

  try {
    const loopStartedAt = Date.now();
    const graphResult = await runAgentGraphTurn({
      traceId,
      userId,
      channelId,
      guildId,
      apiKey,
      model,
      temperature: 0.6,
      timeoutMs: appConfig.TIMEOUT_CHAT_MS,
      maxTokens: normalizeStrictlyPositiveInt(
        appConfig.AGENT_GRAPH_MAX_OUTPUT_TOKENS as number | undefined,
        1_800,
      ),
      messages: runtimeMessages,
      activeToolNames,
      routeKind: SINGLE_ROUTE_KIND,
      currentTurn,
      replyTarget,
      invokedBy,
      invokerIsAdmin: isAdmin,
    });
    finalReplyText = graphResult.replyText;
    files = graphResult.files;
    toolResults = graphResult.toolResults;
    graphTraceEvents = [
      ...graphResult.roundEvents.map((event) => ({
        type: 'tool_round',
        timestamp: event.completedAt,
        details: event,
      })),
      ...(graphResult.finalization.attempted
        ? [
          {
            type: 'tool_finalization',
            timestamp: graphResult.finalization.completedAt,
            details: graphResult.finalization,
          },
        ]
        : []),
    ];
    const successfulToolCount = graphResult.toolResults.filter((result) => result.success).length;
    graphBudgetJson = {
      enabled: activeToolNames.length > 0,
      toolsExecuted: graphResult.toolResults.length > 0,
      roundsCompleted: graphResult.roundsCompleted,
      terminationReason: graphResult.terminationReason,
      toolResultCount: graphResult.toolResults.length,
      successfulToolCount,
      deduplicatedCallCount: graphResult.deduplicatedCallCount,
      truncatedCallCount: graphResult.truncatedCallCount,
      guardrailBlockedCallCount: graphResult.guardrailBlockedCallCount,
      roundEvents: graphResult.roundEvents,
      finalization: graphResult.finalization,
      cancellationCount: graphResult.cancellationCount,
      attachmentCount: graphResult.files.length,
      latencyMs: Date.now() - loopStartedAt,
      graphStatus: graphResult.graphStatus,
      approvalInterrupt: graphResult.approvalInterrupt,
    };
    graphTraceEvents = [
      ...graphTraceEvents,
      ...graphResult.traceEvents,
    ];
  } catch (error) {
    logger.error({ error, traceId }, 'Single-agent runtime call failed');
    finalReplyText = "I'm having trouble connecting right now. Please try again later.";
    graphBudgetJson = {
      enabled: activeToolNames.length > 0,
      failed: true,
      errorText: error instanceof Error ? error.message : String(error),
    };
  }
  let groundedReplyText = finalReplyText;
  if (graphConfig.githubGroundedMode) {
    const groundingResult = enforceGitHubFileGrounding(groundedReplyText, toolResults);
    if (groundingResult.modified) {
      logger.warn(
        {
          traceId,
          ungroundedPaths: groundingResult.ungroundedPaths,
          successfulPaths: groundingResult.successfulPaths,
        },
        'Final response replaced due to ungrounded GitHub file path claims',
      );
      groundedReplyText = groundingResult.replyText;
    }
  }
  const cleanedReplyText = scrubFinalReplyText({
    replyText: groundedReplyText,
  });
  const approvalInterrupt = graphBudgetJson?.approvalInterrupt as
    | { requestId?: string }
    | undefined;
  const safeFinalReplyText =
    cleanedReplyText ||
    (approvalInterrupt ? 'I queued that for approval.' : '') ||
    'I completed part of the request but could not format a final response. Please ask me to try once more.';
  const budgetJson: Record<string, unknown> = {
    route: SINGLE_ROUTE_KIND,
    model,
    graphRuntime: graphBudgetJson,
    promptUserText:
      userText.length <= 6_000 ? userText : `${userText.slice(0, 6_000)}...`,
    promptUserTextTruncated: userText.length > 6_000,
    toolCount: activeToolNames.length,
    attachmentCount: files.length,
  };

  if (appConfig.TRACE_ENABLED) {
    try {
      await updateTraceEnd({
        id: traceId,
        toolJson: {
          enabled: activeToolNames.length > 0,
          routeTools: activeToolNames,
          graph: graphBudgetJson,
        },
        qualityJson: {
          model,
          route: SINGLE_ROUTE_KIND,
        },
        budgetJson,
        threadId: traceId,
        graphStatus: (graphBudgetJson?.graphStatus as string | undefined) ?? 'completed',
        approvalRequestId: approvalInterrupt?.requestId ?? null,
        interruptJson: approvalInterrupt,
        agentEventsJson: [
          ...graphTraceEvents,
          {
            type: 'runtime_end',
            route: SINGLE_ROUTE_KIND,
            timestamp: new Date().toISOString(),
            details: {
              files: files.length,
              toolResults: toolResults.length,
            },
          },
        ],
        replyText: safeFinalReplyText,
      });
    } catch (error) {
      logger.warn({ error, traceId }, 'Failed to persist trace end');
    }
  }

  if (safeFinalReplyText.trim() === '[SILENCE]') {
    logger.info({ traceId }, 'Agent chose silence');
    clearToolCaches();
    return {
      replyText: '',
      meta: undefined,
      debug: { messages: runtimeMessages },
    };
  }

  clearToolCaches();
  return {
    replyText: safeFinalReplyText,
    meta: undefined,
    debug: { messages: runtimeMessages },
    files,
  };
}
