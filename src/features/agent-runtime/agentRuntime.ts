import { config as appConfig } from '../../platform/config/env';
import { getApprovalReviewRequestById } from '../admin/approvalReviewRequestRepo';
import {
  buildContinuationAccessDeniedText,
  buildContinuationAlreadyClosedText,
  buildContinuationExpiredText,
  buildMissingHostedGuildActivationFallbackText,
  buildMissingHostApiKeyText,
  buildMissingSelfHostedGuildApiKeyText,
} from '../discord/userFacingCopy';
import { getRecentMessages } from '../awareness/channelRingBuffer';
import { buildTranscriptBlock } from '../awareness/transcriptBuilder';
import { type BaseMessage } from '@langchain/core/messages';
import { LLMMessageContent } from '../../platform/llm/llm-types';
import { getGuildSagePersonaText } from '../settings/guildSagePersonaRepo';
import { isLoggingEnabled } from '../settings/guildChannelSettings';
import { logger } from '../../platform/logging/logger';
import { normalizeStrictlyPositiveInt } from '../../shared/utils/numbers';
import { upsertTraceStart, updateTraceEnd } from './agent-trace-repo';
import { buildContextMessages } from './contextBuilder';
import { clearGitHubFileLookupCacheForTrace } from './toolIntegrations';
import { enforceGitHubFileGrounding } from './toolGrounding';
import { buildAgentGraphConfig } from './langgraph/config';
import { resolveApiKeyForRuntime } from './apiKeyResolver';
import { resumeAgentGraphTurn, retryAgentGraphTurn, runAgentGraphTurn } from './langgraph/runtime';
import {
  buildContinuationUnavailableReply,
  buildRuntimeFailureReply,
  type RuntimeFailureCategory,
} from './visibleReply';
import {
  getGraphContinuationSessionById,
  markGraphContinuationSessionExpired,
  type AgentContinuationSessionRecord,
} from './graphContinuationRepo';

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
  canModerate?: boolean;
}

export interface RunChatTurnResult {
  replyText: string;
  delivery: 'chat_reply' | 'tool_delivered' | 'approval_governance_only' | 'chat_reply_with_continue';
  meta?: {
    kind?: 'missing_api_key';
    missingApiKey?: {
      recovery: 'host_api_key' | 'server_key_activation';
    };
    approvalReview?: {
      requestId: string;
      reviewChannelId: string;
      sourceChannelId: string;
    };
    continuation?: {
      id: string;
      expiresAtIso: string;
      completedWindows: number;
      maxWindows: number;
      summaryText: string;
    };
    retry?: {
      threadId: string;
      retryKind: 'turn' | 'continue_resume';
    };
  };
  debug?: {
    messages?: BaseMessage[];
  };
  files?: Array<{
    attachment: Buffer;
    name: string;
  }>;
}

export interface ResumeContinuationChatTurnParams {
  traceId: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  continuationId: string;
  isAdmin: boolean;
  canModerate?: boolean;
}

export interface RetryFailedChatTurnParams {
  traceId: string;
  threadId: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  retryKind: 'turn' | 'continue_resume';
  isAdmin: boolean;
  canModerate?: boolean;
}

function resolveActiveToolNames(params: {
  isAdmin: boolean;
  canModerate: boolean;
  invokedBy: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';
}): string[] {
  const allToolNames = globalToolRegistry.listNames();
  return allToolNames.filter((toolName) => {
    const tool = globalToolRegistry.get(toolName);
    if (!tool) return false;
    const access = tool.metadata?.access ?? 'public';
    if (access === 'public') return true;
    if (params.invokedBy === 'autopilot') return false;
    if (params.isAdmin) return true;
    return toolName === 'discord_admin' && params.canModerate;
  });
}

function classifyGraphFailure(error: unknown): RuntimeFailureCategory {
  const text = error instanceof Error ? error.message : String(error);
  if (/AI provider|provider offline|provider unavailable|model error|upstream/i.test(text)) {
    return 'provider';
  }
  return 'runtime';
}

function buildRetryMeta(
  threadId: string,
  retryKind: 'turn' | 'continue_resume',
): NonNullable<RunChatTurnResult['meta']> {
  return {
    retry: {
      threadId,
      retryKind,
    },
  };
}

function shouldUseHostedServerKeyRecovery(): boolean {
  const candidateUrls = [
    appConfig.SERVER_PROVIDER_AUTHORIZE_URL,
    appConfig.SERVER_PROVIDER_PROFILE_URL,
    appConfig.SERVER_PROVIDER_DASHBOARD_URL,
  ];

  return candidateUrls.some((candidateUrl) => {
    try {
      const hostname = new URL(candidateUrl).hostname.toLowerCase();
      return hostname === 'pollinations.ai' || hostname.endsWith('.pollinations.ai');
    } catch {
      return false;
    }
  });
}

function buildMissingApiKeyResult(guildId: string | null): RunChatTurnResult {
  const useHostedRecovery = guildId && shouldUseHostedServerKeyRecovery();
  return {
    replyText: useHostedRecovery
      ? buildMissingHostedGuildActivationFallbackText()
      : guildId
      ? buildMissingSelfHostedGuildApiKeyText()
      : buildMissingHostApiKeyText(),
    delivery: 'chat_reply',
    meta: guildId
      ? {
          kind: 'missing_api_key',
          missingApiKey: {
            recovery: useHostedRecovery ? 'server_key_activation' : 'host_api_key',
          },
        }
      : undefined,
  };
}

async function buildRunChatTurnMeta(params: {
  pendingInterrupt:
    | { kind: 'approval_review'; requestId: string }
    | {
        kind: 'continue_prompt';
        continuationId: string;
        expiresAtIso: string;
        completedWindows: number;
        maxWindows: number;
        summaryText: string;
      }
    | null;
}): Promise<RunChatTurnResult['meta'] | undefined> {
  if (!params.pendingInterrupt) {
    return undefined;
  }

  if (params.pendingInterrupt.kind === 'continue_prompt') {
    return buildContinuationMeta(params.pendingInterrupt);
  }

  const action = await getApprovalReviewRequestById(params.pendingInterrupt.requestId).catch(() => null);
  if (!action) {
    return {
      approvalReview: {
        requestId: params.pendingInterrupt.requestId,
        reviewChannelId: '',
        sourceChannelId: '',
      },
    };
  }

  return {
    approvalReview: {
      requestId: action.id,
      reviewChannelId: action.reviewChannelId,
      sourceChannelId: action.sourceChannelId,
    },
  };
}

type RuntimeGraphResult = Awaited<ReturnType<typeof runAgentGraphTurn>>;

function toPendingInterruptSummary(
  pendingInterrupt: RuntimeGraphResult['pendingInterrupt'],
):
  | {
      kind: 'approval_review';
      requestId: string;
    }
  | {
      kind: 'continue_prompt';
      continuationId: string;
      expiresAtIso: string;
      completedWindows: number;
      maxWindows: number;
      summaryText: string;
    }
  | null {
  return pendingInterrupt?.kind === 'approval_review'
    ? {
        kind: 'approval_review',
        requestId: pendingInterrupt.requestId,
      }
    : pendingInterrupt?.kind === 'continue_prompt'
      ? {
          kind: 'continue_prompt',
          continuationId: pendingInterrupt.continuationId,
          expiresAtIso: pendingInterrupt.expiresAtIso,
          completedWindows: pendingInterrupt.completedWindows,
          maxWindows: pendingInterrupt.maxWindows,
          summaryText: pendingInterrupt.summaryText,
        }
      : null;
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
    canModerate = false,
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
      ? buildTranscriptBlock(focusedContinuityMessages, {
          header:
            'Focused continuity window (most recent last). Use this first for same-speaker or reply-chain continuity before reading ambient room context:',
          focusUserId: currentTurn.invokerUserId,
          sageUserId: currentTurn.botUserId ?? null,
        })
      : null;

  const transcriptBlock =
    recentMessages.length > 0
      ? buildTranscriptBlock(recentMessages, {
          excludedMessageIds: excludedAmbientMessageIds,
          focusUserId: currentTurn.invokerUserId,
          sageUserId: currentTurn.botUserId ?? null,
        })
      : null;

  const liveVoiceContext =
    guildId && isVoiceActive && voiceChannelId
      ? formatLiveVoiceContext({ guildId, voiceChannelId, now: new Date() })
      : null;

  const apiKey = await resolveApiKeyForRuntime(guildId);
  if (!apiKey) {
    logger.warn(
      { guildId, channelId, userId },
      'No API key configured for chat turn; returning setup guidance response',
    );
    clearToolCaches();
    return buildMissingApiKeyResult(guildId);
  }

  let guildSagePersona: string | null = null;
  if (guildId) {
    try {
      guildSagePersona = await getGuildSagePersonaText(guildId);
    } catch (error) {
      logger.warn({ error, guildId }, 'Failed to load guild Sage Persona (non-fatal)');
    }
  }
  const model = appConfig.AI_PROVIDER_MAIN_AGENT_MODEL.trim();
  const graphConfig = buildAgentGraphConfig();
  const graphLimits = {
    maxRounds: graphConfig.maxSteps,
  };
  const autopilotMode = resolveRuntimeAutopilotMode({
    invokedBy,
    configuredMode: appConfig.AUTOPILOT_MODE,
  });

  const activeToolNames = resolveActiveToolNames({ isAdmin, canModerate, invokedBy });
  const capabilityParams: BuildCapabilityPromptSectionParams = {
    activeTools: activeToolNames,
    model,
    invokedBy,
    invokerIsAdmin: isAdmin,
    invokerCanModerate: canModerate,
    inGuild: guildId !== null,
    turnMode: isVoiceActive ? 'voice' : 'text',
    autopilotMode,
    graphLimits,
  };

  const runtimeInstruction = buildCapabilityPromptSection(capabilityParams);

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

  if (appConfig.SAGE_TRACE_DB_ENABLED) {
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
      });
    } catch (error) {
      logger.warn({ error, traceId }, 'Failed to persist trace start');
    }
  }

  let graphBudgetJson: Record<string, unknown> | undefined;
  let toolResults: ToolResult[] = [];
  let finalReplyText: string;
  let files: Array<{ attachment: Buffer; name: string }> = [];
  let pendingInterrupt:
    | {
        kind: 'approval_review';
        requestId: string;
      }
    | {
        kind: 'continue_prompt';
        continuationId: string;
        expiresAtIso: string;
        completedWindows: number;
        maxWindows: number;
        summaryText: string;
      }
    | null = null;
  let delivery: RunChatTurnResult['delivery'] = 'chat_reply';
  let meta: RunChatTurnResult['meta'] | undefined;
  let langSmithRunId: string | null = null;
  let langSmithTraceId: string | null = null;

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
      invokerCanModerate: canModerate,
    });
    finalReplyText = graphResult.replyText;
    files = graphResult.files;
    toolResults = graphResult.toolResults;
    pendingInterrupt = toPendingInterruptSummary(graphResult.pendingInterrupt);
    delivery = graphResult.deliveryDisposition;
    meta = await buildRunChatTurnMeta({ pendingInterrupt });
    langSmithRunId = graphResult.langSmithRunId;
    langSmithTraceId = graphResult.langSmithTraceId;
    const successfulToolCount = graphResult.toolResults.filter((result) => result.success).length;
    graphBudgetJson = {
      enabled: activeToolNames.length > 0,
      toolsExecuted: graphResult.toolResults.length > 0,
      roundsCompleted: graphResult.roundsCompleted,
      completedWindows: graphResult.completedWindows,
      totalRoundsCompleted: graphResult.totalRoundsCompleted,
      completionKind: graphResult.completionKind,
      stopReason: graphResult.stopReason,
      deliveryDisposition: graphResult.deliveryDisposition,
      toolResultCount: graphResult.toolResults.length,
      successfulToolCount,
      deduplicatedCallCount: graphResult.deduplicatedCallCount,
      roundEvents: graphResult.roundEvents,
      finalization: graphResult.finalization,
      protocolRepairCount: graphResult.protocolRepairCount,
      toolDeliveredFinal: graphResult.toolDeliveredFinal,
      contextFrame: graphResult.contextFrame,
      attachmentCount: graphResult.files.length,
      latencyMs: Date.now() - loopStartedAt,
      graphStatus: graphResult.graphStatus,
      pendingInterrupt,
      interruptResolution: graphResult.interruptResolution,
      langSmithRunId,
      langSmithTraceId,
    };
  } catch (error) {
    logger.error({ error, traceId }, 'Single-agent runtime call failed');
    const failureCategory = classifyGraphFailure(error);
    finalReplyText = buildRuntimeFailureReply({
      kind: 'turn',
      category: failureCategory,
    });
    meta = buildRetryMeta(traceId, 'turn');
    graphBudgetJson = {
      enabled: activeToolNames.length > 0,
      failed: true,
      failureCategory,
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
  const safeFinalReplyText = groundedReplyText;
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

  if (appConfig.SAGE_TRACE_DB_ENABLED) {
    try {
      await updateTraceEnd({
        id: traceId,
        toolJson: {
          enabled: activeToolNames.length > 0,
          routeTools: activeToolNames,
          graph: graphBudgetJson,
        },
        budgetJson,
        tokenJson: {
          model,
          route: SINGLE_ROUTE_KIND,
          activeToolNames,
        },
        threadId: traceId,
        graphStatus: (graphBudgetJson?.graphStatus as string | undefined) ?? 'completed',
        approvalRequestId: pendingInterrupt?.kind === 'approval_review' ? pendingInterrupt.requestId : null,
        terminationReason: null,
        langSmithRunId,
        langSmithTraceId,
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
      delivery,
      meta,
      debug: { messages: runtimeMessages },
    };
  }

  clearToolCaches();
  return {
    replyText: safeFinalReplyText,
    delivery,
    meta,
    debug: { messages: runtimeMessages },
    files,
  };
}

async function loadValidatedContinuation(params: {
  continuationId: string;
  userId: string;
  channelId: string;
}): Promise<
  | { ok: true; session: AgentContinuationSessionRecord }
  | { ok: false; replyText: string }
> {
  const session = await getGraphContinuationSessionById(params.continuationId);
  if (!session) {
    return {
      ok: false,
      replyText: buildContinuationUnavailableReply(),
    };
  }
  if (session.requestedByUserId !== params.userId || session.channelId !== params.channelId) {
    return {
      ok: false,
      replyText: buildContinuationAccessDeniedText(),
    };
  }
  if (session.status !== 'pending') {
    return {
      ok: false,
      replyText: buildContinuationAlreadyClosedText(),
    };
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    await markGraphContinuationSessionExpired(session.id).catch(() => undefined);
    return {
      ok: false,
      replyText: buildContinuationExpiredText(),
    };
  }

  return { ok: true, session };
}

export async function resumeContinuationChatTurn(
  params: ResumeContinuationChatTurnParams,
): Promise<RunChatTurnResult> {
  const validated = await loadValidatedContinuation({
    continuationId: params.continuationId,
    userId: params.userId,
    channelId: params.channelId,
  });
  if (!validated.ok) {
    return {
      replyText: validated.replyText,
      delivery: 'chat_reply',
      meta: undefined,
      files: [],
    };
  }

  const session = validated.session;
  const apiKey = await resolveApiKeyForRuntime(params.guildId);
  if (!apiKey) {
    return buildMissingApiKeyResult(params.guildId);
  }
  const model = appConfig.AI_PROVIDER_MAIN_AGENT_MODEL.trim();
  const activeToolNames = resolveActiveToolNames({
    isAdmin: params.isAdmin,
    canModerate: params.canModerate ?? false,
    invokedBy: 'component',
  });
  const maxTokens = normalizeStrictlyPositiveInt(
    appConfig.AGENT_GRAPH_MAX_OUTPUT_TOKENS as number | undefined,
    1_800,
  );
  if (appConfig.SAGE_TRACE_DB_ENABLED) {
    try {
      await upsertTraceStart({
        id: params.traceId,
        guildId: params.guildId,
        channelId: params.channelId,
        userId: params.userId,
        routeKind: 'continue_resume',
        tokenJson: {
          continuationId: session.id,
          threadId: session.threadId,
        },
        budgetJson: {
          route: 'continue_resume',
          continuationId: session.id,
          completedWindows: session.completedWindows,
        },
        threadId: session.threadId,
        parentTraceId: session.latestTraceId,
        graphStatus: 'running',
      });
    } catch (error) {
      logger.warn({ error, traceId: params.traceId }, 'Failed to persist continuation resume trace start');
    }
  }

  let result: RunChatTurnResult;
  try {
    const graphResult = await resumeAgentGraphTurn({
      threadId: session.threadId,
      resume: {
        interruptKind: 'continue_prompt',
        decision: 'continue',
        continuationId: session.id,
        resumedByUserId: params.userId,
        resumeTraceId: params.traceId,
      },
      context: {
        traceId: params.traceId,
        userId: params.userId,
        channelId: params.channelId,
        guildId: params.guildId,
        apiKey,
        model,
        temperature: 0.6,
        timeoutMs: appConfig.TIMEOUT_CHAT_MS,
        maxTokens,
        invokedBy: 'component',
        invokerIsAdmin: params.isAdmin,
        invokerCanModerate: params.canModerate ?? false,
        activeToolNames,
        routeKind: 'continue_resume',
      },
    });
    const pendingInterrupt = toPendingInterruptSummary(graphResult.pendingInterrupt);
    result = {
      replyText: graphResult.replyText,
      delivery: graphResult.deliveryDisposition,
      meta: await buildRunChatTurnMeta({ pendingInterrupt }),
      files: graphResult.files,
    };

    if (appConfig.SAGE_TRACE_DB_ENABLED) {
      await updateTraceEnd({
        id: params.traceId,
        toolJson: {
          enabled: activeToolNames.length > 0,
          graph: {
            roundsCompleted: graphResult.roundsCompleted,
            completedWindows: graphResult.completedWindows,
            totalRoundsCompleted: graphResult.totalRoundsCompleted,
            completionKind: graphResult.completionKind,
            stopReason: graphResult.stopReason,
            deliveryDisposition: graphResult.deliveryDisposition,
            protocolRepairCount: graphResult.protocolRepairCount,
            contextFrame: graphResult.contextFrame,
            graphStatus: graphResult.graphStatus,
            pendingInterrupt,
            interruptResolution: graphResult.interruptResolution,
          },
        },
        budgetJson: {
          route: 'continue_resume',
          graphRuntime: {
            roundsCompleted: graphResult.roundsCompleted,
            completedWindows: graphResult.completedWindows,
            totalRoundsCompleted: graphResult.totalRoundsCompleted,
            completionKind: graphResult.completionKind,
            stopReason: graphResult.stopReason,
            deliveryDisposition: graphResult.deliveryDisposition,
            protocolRepairCount: graphResult.protocolRepairCount,
            contextFrame: graphResult.contextFrame,
            graphStatus: graphResult.graphStatus,
          },
        },
        tokenJson: {
          model,
          activeToolNames,
          continuationId: session.id,
          threadId: session.threadId,
        },
        threadId: session.threadId,
        parentTraceId: session.latestTraceId,
        graphStatus: graphResult.graphStatus,
        approvalRequestId: pendingInterrupt?.kind === 'approval_review' ? pendingInterrupt.requestId : null,
        terminationReason: null,
        langSmithRunId: graphResult.langSmithRunId,
        langSmithTraceId: graphResult.langSmithTraceId,
        replyText: graphResult.replyText,
      });
    }
  } catch (error) {
    logger.error({ error, traceId: params.traceId }, 'Continuation resume failed');
    const failureCategory = classifyGraphFailure(error);
    result = {
      replyText: buildRuntimeFailureReply({
        kind: 'continue_resume',
        category: failureCategory,
      }),
      delivery: 'chat_reply',
      meta: buildRetryMeta(session.threadId, 'continue_resume'),
      files: [],
    };
    if (appConfig.SAGE_TRACE_DB_ENABLED) {
      await updateTraceEnd({
        id: params.traceId,
        threadId: session.threadId,
        parentTraceId: session.latestTraceId,
        graphStatus: 'failed',
        approvalRequestId: null,
        terminationReason: 'continue_resume_failed',
        replyText: result.replyText,
        budgetJson: {
          route: 'continue_resume',
          failed: true,
          continuationId: session.id,
          failureCategory,
          errorText: error instanceof Error ? error.message : String(error),
        },
      }).catch(() => undefined);
    }
  }

  return result;
}

export async function retryFailedChatTurn(
  params: RetryFailedChatTurnParams,
): Promise<RunChatTurnResult> {
  const apiKey = await resolveApiKeyForRuntime(params.guildId);
  if (!apiKey) {
    return buildMissingApiKeyResult(params.guildId);
  }

  const model = appConfig.AI_PROVIDER_MAIN_AGENT_MODEL.trim();
  const activeToolNames = resolveActiveToolNames({
    isAdmin: params.isAdmin,
    canModerate: params.canModerate ?? false,
    invokedBy: 'component',
  });
  const routeKind = params.retryKind === 'continue_resume' ? 'continue_retry' : 'turn_retry';

  if (appConfig.SAGE_TRACE_DB_ENABLED) {
    try {
      await upsertTraceStart({
        id: params.traceId,
        guildId: params.guildId,
        channelId: params.channelId,
        userId: params.userId,
        routeKind,
        tokenJson: {
          model,
          retryKind: params.retryKind,
          retryThreadId: params.threadId,
        },
        budgetJson: {
          route: routeKind,
          retryKind: params.retryKind,
        },
        threadId: params.threadId,
        parentTraceId: params.threadId,
        graphStatus: 'running',
      });
    } catch (error) {
      logger.warn({ error, traceId: params.traceId }, 'Failed to persist retry trace start');
    }
  }

  try {
    const graphResult = await retryAgentGraphTurn({
      threadId: params.threadId,
      runId: params.traceId,
      runName: params.retryKind === 'continue_resume' ? 'sage_agent_continue_retry' : 'sage_agent_turn_retry',
      context: {
        traceId: params.traceId,
        threadId: params.threadId,
        userId: params.userId,
        channelId: params.channelId,
        guildId: params.guildId,
        apiKey,
        model,
        temperature: 0.6,
        timeoutMs: appConfig.TIMEOUT_CHAT_MS,
        maxTokens: normalizeStrictlyPositiveInt(
          appConfig.AGENT_GRAPH_MAX_OUTPUT_TOKENS as number | undefined,
          1_800,
        ),
        invokedBy: 'component',
        invokerIsAdmin: params.isAdmin,
        invokerCanModerate: params.canModerate ?? false,
        activeToolNames,
        routeKind,
      },
    });

    const pendingInterrupt = toPendingInterruptSummary(graphResult.pendingInterrupt);
    const replyText = graphResult.replyText;
    const result: RunChatTurnResult = {
      replyText,
      delivery: graphResult.deliveryDisposition,
      meta: await buildRunChatTurnMeta({ pendingInterrupt }),
      files: graphResult.files,
    };

    if (appConfig.SAGE_TRACE_DB_ENABLED) {
      await updateTraceEnd({
        id: params.traceId,
        toolJson: {
          enabled: activeToolNames.length > 0,
          graph: {
            roundsCompleted: graphResult.roundsCompleted,
            completedWindows: graphResult.completedWindows,
            totalRoundsCompleted: graphResult.totalRoundsCompleted,
            completionKind: graphResult.completionKind,
            stopReason: graphResult.stopReason,
            deliveryDisposition: graphResult.deliveryDisposition,
            protocolRepairCount: graphResult.protocolRepairCount,
            contextFrame: graphResult.contextFrame,
            graphStatus: graphResult.graphStatus,
            pendingInterrupt,
            interruptResolution: graphResult.interruptResolution,
          },
        },
        budgetJson: {
          route: routeKind,
          retryKind: params.retryKind,
          graphRuntime: {
            roundsCompleted: graphResult.roundsCompleted,
            completedWindows: graphResult.completedWindows,
            totalRoundsCompleted: graphResult.totalRoundsCompleted,
            completionKind: graphResult.completionKind,
            stopReason: graphResult.stopReason,
            deliveryDisposition: graphResult.deliveryDisposition,
            protocolRepairCount: graphResult.protocolRepairCount,
            contextFrame: graphResult.contextFrame,
            graphStatus: graphResult.graphStatus,
          },
        },
        tokenJson: {
          model,
          activeToolNames,
          retryThreadId: params.threadId,
          retryKind: params.retryKind,
        },
        threadId: params.threadId,
        parentTraceId: params.threadId,
        graphStatus: graphResult.graphStatus,
        terminationReason: null,
        langSmithRunId: graphResult.langSmithRunId,
        langSmithTraceId: graphResult.langSmithTraceId,
        approvalRequestId: pendingInterrupt?.kind === 'approval_review' ? pendingInterrupt.requestId : null,
        replyText,
      }).catch(() => undefined);
    }

    return result;
  } catch (error) {
    logger.error({ error, traceId: params.traceId, threadId: params.threadId }, 'Failed to retry graph turn');
    const failureCategory = classifyGraphFailure(error);
    const replyText = buildRuntimeFailureReply({
      kind: params.retryKind,
      category: failureCategory,
    });

    if (appConfig.SAGE_TRACE_DB_ENABLED) {
      await updateTraceEnd({
        id: params.traceId,
        toolJson: {
          enabled: activeToolNames.length > 0,
          graph: {
            failed: true,
            failureCategory,
            errorText: error instanceof Error ? error.message : String(error),
          },
        },
        budgetJson: {
          route: routeKind,
          retryKind: params.retryKind,
          graphRuntime: {
            failed: true,
            failureCategory,
          },
        },
        tokenJson: {
          model,
          activeToolNames,
          retryThreadId: params.threadId,
          retryKind: params.retryKind,
        },
        threadId: params.threadId,
        parentTraceId: params.threadId,
        graphStatus: 'failed',
        replyText,
      }).catch(() => undefined);
    }

    return {
      replyText,
      delivery: 'chat_reply',
      meta: buildRetryMeta(params.threadId, params.retryKind),
      files: [],
    };
  }
}

function buildContinuationMeta(
  pendingInterrupt: {
    kind: 'continue_prompt';
    continuationId: string;
    expiresAtIso: string;
    completedWindows: number;
    maxWindows: number;
    summaryText: string;
  } | null,
): RunChatTurnResult['meta'] {
  if (!pendingInterrupt) {
    return undefined;
  }
  return {
    continuation: {
      id: pendingInterrupt.continuationId,
      expiresAtIso: pendingInterrupt.expiresAtIso,
      completedWindows: pendingInterrupt.completedWindows,
      maxWindows: pendingInterrupt.maxWindows,
      summaryText: pendingInterrupt.summaryText,
    },
  };
}
