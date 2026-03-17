import { config as appConfig } from '../../platform/config/env';
import { getApprovalReviewRequestById } from '../admin/approvalReviewRequestRepo';
import {
  buildMissingHostedGuildActivationFallbackText,
  buildMissingHostApiKeyText,
  buildMissingSelfHostedGuildApiKeyText,
} from '../discord/userFacingCopy';
import { getRecentMessages } from '../awareness/channelRingBuffer';
import { buildTranscriptBlock } from '../awareness/transcriptBuilder';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { LLMMessageContent } from '../../platform/llm/llm-types';
import { getGuildSagePersonaText } from '../settings/guildSagePersonaRepo';
import { isLoggingEnabled } from '../settings/guildChannelSettings';
import { logger } from '../../platform/logging/logger';
import { normalizeStrictlyPositiveInt } from '../../shared/utils/numbers';
import { upsertTraceStart, updateTraceEnd } from './agent-trace-repo';
import { clearGitHubFileLookupCacheForTrace } from './toolIntegrations';
import { enforceGitHubFileGrounding } from './toolGrounding';
import { buildAgentGraphConfig } from './langgraph/config';
import { resolveApiKeyForRuntime } from './apiKeyResolver';
import { continueAgentGraphTurn, retryAgentGraphTurn, runAgentGraphTurn } from './langgraph/runtime';
import {
  buildTaskRunLimitReply,
  buildRuntimeFailureReply,
  type RuntimeFailureCategory,
} from './visibleReply';
import {
  buildPromptContextMessages,
  type PromptInputMode,
} from './promptContract';
import {
  findWaitingUserInputTaskRun,
  getAgentTaskRunByThreadId,
  releaseAgentTaskRunLease,
  upsertAgentTaskRun,
  updateAgentTaskRunByThreadId,
} from './agentTaskRunRepo';
import {
  CurrentTurnContext,
  ReplyTargetContext,
  selectFocusedContinuityMessages,
} from './continuityContext';
import { resolveRuntimeAutopilotMode } from './autopilotMode';
import { globalToolRegistry, type ToolDefinition } from './toolRegistry';
import type { ToolResult } from './toolCallExecution';
import type { GraphDeliveryDisposition, GraphWaitingState } from './langgraph/types';

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
  promptMode?: PromptInputMode;
  onResponseSessionUpdate?: (update: {
    replyText: string;
    delivery: GraphDeliveryDisposition;
    responseSession: RuntimeGraphResult['responseSession'];
    pendingInterrupt: RuntimeGraphResult['pendingInterrupt'];
    completionKind: RuntimeGraphResult['completionKind'];
    stopReason: RuntimeGraphResult['stopReason'];
  }) => Promise<void> | void;
}

export interface RunChatTurnResult {
  runId?: string;
  status?: 'running' | 'waiting_user_input' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
  replyText: string;
  delivery: GraphDeliveryDisposition;
  completionKind?: RuntimeGraphResult['completionKind'];
  stopReason?: RuntimeGraphResult['stopReason'];
  waitingState?: GraphWaitingState | null;
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
    retry?: {
      threadId: string;
      retryKind: 'turn' | 'background_resume';
    };
  };
  debug?: {
    messages?: BaseMessage[];
    promptVersion?: string;
    promptFingerprint?: string;
  };
  files?: Array<{
    attachment: Buffer;
    name: string;
  }>;
  responseSession?: RuntimeGraphResult['responseSession'];
  artifactDeliveries?: RuntimeGraphResult['artifactDeliveries'];
  compactionState?: RuntimeGraphResult['compactionState'];
}

export interface ResumeWaitingTaskRunWithInputParams {
  traceId: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  replyToMessageId?: string | null;
  userText: string;
  userContent?: LLMMessageContent;
  currentTurn: CurrentTurnContext;
  replyTarget?: ReplyTargetContext | null;
  promptMode?: PromptInputMode;
  isAdmin: boolean;
  canModerate?: boolean;
  onResponseSessionUpdate?: RunChatTurnParams['onResponseSessionUpdate'];
}

export interface RetryFailedChatTurnParams {
  traceId: string;
  threadId: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  retryKind: 'turn' | 'background_resume';
  isAdmin: boolean;
  canModerate?: boolean;
}

type ToolInvocationKind = 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';

function getToolAccessTier(tool: Pick<ToolDefinition<unknown>, 'runtime' | 'metadata'>): 'public' | 'admin' {
  return tool.runtime?.access ?? tool.metadata?.access ?? 'public';
}

function resolveActiveToolNames(params: {
  isAdmin: boolean;
  canModerate: boolean;
  invokedBy: ToolInvocationKind;
}): string[] {
  return globalToolRegistry.listNames().filter((toolName) => {
    const tool = globalToolRegistry.get(toolName);
    if (!tool) {
      return false;
    }
    const access = getToolAccessTier(tool);
    if (access === 'public') {
      return true;
    }
    if (params.invokedBy === 'autopilot') {
      return false;
    }
    if (params.isAdmin) {
      return true;
    }
    const capabilityTags = tool.runtime?.capabilityTags ?? [];
    return params.canModerate && capabilityTags.includes('moderation');
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
  retryKind: 'turn' | 'background_resume',
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
    delivery: 'response_session',
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
  pendingInterrupt: { kind: 'approval_review'; requestId: string } | null;
}): Promise<RunChatTurnResult['meta'] | undefined> {
  if (!params.pendingInterrupt) {
    return undefined;
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

type PersistedResponseSessionRefs = {
  sourceMessageId: string | null;
  responseMessageId: string | null;
};

function readPersistedResponseSessionRefs(value: unknown): PersistedResponseSessionRefs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      sourceMessageId: null,
      responseMessageId: null,
    };
  }

  const record = value as Record<string, unknown>;
  return {
    sourceMessageId: typeof record.sourceMessageId === 'string' ? record.sourceMessageId : null,
    responseMessageId: typeof record.responseMessageId === 'string' ? record.responseMessageId : null,
  };
}

function mergeResponseSessionRefs(
  existingValue: unknown,
  nextValue: RuntimeGraphResult['responseSession'],
): RuntimeGraphResult['responseSession'] {
  const existingRefs = readPersistedResponseSessionRefs(existingValue);
  return {
    ...nextValue,
    sourceMessageId: nextValue?.sourceMessageId ?? existingRefs.sourceMessageId,
    responseMessageId: nextValue?.responseMessageId ?? existingRefs.responseMessageId,
  };
}

function toPendingInterruptSummary(
  pendingInterrupt: RuntimeGraphResult['pendingInterrupt'],
): { kind: 'approval_review'; requestId: string } | null {
  return pendingInterrupt?.kind === 'approval_review'
    ? {
        kind: 'approval_review',
        requestId: pendingInterrupt.requestId,
      }
    : null;
}

function deriveTaskRunStatus(graphResult: RuntimeGraphResult): RunChatTurnResult['status'] {
  if (graphResult.stopReason === 'background_yield') {
    return 'running';
  }
  if (graphResult.completionKind === 'approval_pending') {
    return 'waiting_approval';
  }
  if (graphResult.completionKind === 'clarification_question') {
    return 'waiting_user_input';
  }
  if (graphResult.completionKind === 'runtime_failure' || graphResult.completionKind === 'loop_guard') {
    return 'failed';
  }
  if (graphResult.completionKind === 'cancelled') {
    return 'cancelled';
  }
  return 'completed';
}

type TaskRunLimitKind = 'duration' | 'idle_wait' | 'resume_limit';

function resolveTaskRunLimitKind(params: {
  taskRun: {
    startedAt: Date;
    updatedAt: Date;
    taskWallClockMs: number;
    maxTotalDurationMs: number;
    maxIdleWaitMs: number;
    resumeCount: number;
  };
  maxResumes: number;
  now?: Date;
}): TaskRunLimitKind | null {
  const now = params.now ?? new Date();
  const totalElapsedMs = now.getTime() - params.taskRun.startedAt.getTime();
  if (
    params.taskRun.taskWallClockMs >= params.taskRun.maxTotalDurationMs ||
    totalElapsedMs >= params.taskRun.maxTotalDurationMs
  ) {
    return 'duration';
  }
  if (params.taskRun.resumeCount >= params.maxResumes) {
    return 'resume_limit';
  }
  const idleElapsedMs = now.getTime() - params.taskRun.updatedAt.getTime();
  if (idleElapsedMs >= params.taskRun.maxIdleWaitMs) {
    return 'idle_wait';
  }
  return null;
}

async function failTaskRunForLimit(params: {
  threadId: string;
  replyText: string;
}): Promise<void> {
  await updateAgentTaskRunByThreadId({
    threadId: params.threadId,
    status: 'failed',
    waitingKind: null,
    stopReason: 'runtime_failure',
    completionKind: 'runtime_failure',
    nextRunnableAt: null,
    completedAt: new Date(),
    lastErrorText: params.replyText,
  }).catch((error) => {
    logger.warn(
      { error, threadId: params.threadId },
      'Failed to mark task run as failed after task-run limit exhaustion',
    );
  });
}

async function persistTaskRunFromGraphResult(params: {
  traceId: string;
  sourceMessageId: string;
  guildId: string | null;
  channelId: string;
  userId: string;
  isAdmin?: boolean;
  canModerate?: boolean;
  graphConfig: ReturnType<typeof buildAgentGraphConfig>;
  graphResult: RuntimeGraphResult;
  existingTaskRun?: Awaited<ReturnType<typeof getAgentTaskRunByThreadId>> | null;
  resumeCount?: number;
}): Promise<void> {
  const status = deriveTaskRunStatus(params.graphResult);
  const mergedResponseSession = mergeResponseSessionRefs(
    params.existingTaskRun?.responseSessionJson,
    params.graphResult.responseSession,
  );
  const persistedResponseRefs = readPersistedResponseSessionRefs(params.existingTaskRun?.responseSessionJson);
  const accumulatedWallClockMs =
    (params.existingTaskRun?.taskWallClockMs ?? 0) +
    Math.max(0, Math.trunc(params.graphResult.activeWindowDurationMs ?? 0));
  await upsertAgentTaskRun({
    threadId: params.traceId,
    originTraceId: params.existingTaskRun?.originTraceId ?? params.traceId,
    latestTraceId: params.graphResult.langSmithTraceId ?? params.traceId,
    guildId: params.existingTaskRun?.guildId ?? params.guildId,
    channelId: params.existingTaskRun?.channelId ?? params.channelId,
    requestedByUserId: params.existingTaskRun?.requestedByUserId ?? params.userId,
    sourceMessageId:
      params.existingTaskRun?.sourceMessageId ??
      mergedResponseSession.sourceMessageId ??
      persistedResponseRefs.sourceMessageId ??
      params.sourceMessageId,
    responseMessageId:
      mergedResponseSession.responseMessageId ??
      params.existingTaskRun?.responseMessageId ??
      persistedResponseRefs.responseMessageId,
    status: status === 'waiting_approval' ? 'waiting_approval' : status === 'waiting_user_input' ? 'waiting_user_input' : status === 'running' ? 'running' : status === 'failed' ? 'failed' : status === 'cancelled' ? 'cancelled' : 'completed',
    waitingKind:
      status === 'waiting_approval'
        ? 'approval_review'
        : status === 'waiting_user_input'
          ? 'user_input'
          : null,
    latestDraftText: mergedResponseSession.latestText || params.graphResult.replyText,
    draftRevision: mergedResponseSession.draftRevision,
    completionKind: params.graphResult.completionKind,
    stopReason: params.graphResult.stopReason,
    nextRunnableAt:
      status === 'running'
        ? new Date(Date.now() + params.graphConfig.workerPollMs)
        : null,
    responseSessionJson: mergedResponseSession,
    waitingStateJson: params.graphResult.waitingState ?? null,
    compactionStateJson: params.graphResult.compactionState ?? null,
    checkpointMetadataJson: {
      yieldReason: params.graphResult.yieldReason,
      sliceIndex: params.graphResult.sliceIndex,
      totalRoundsCompleted: params.graphResult.totalRoundsCompleted,
      isAdmin: params.isAdmin ?? false,
      canModerate: params.canModerate ?? false,
    },
    maxTotalDurationMs: params.existingTaskRun?.maxTotalDurationMs ?? params.graphConfig.maxTotalDurationMs,
    maxIdleWaitMs: params.existingTaskRun?.maxIdleWaitMs ?? params.graphConfig.maxIdleWaitMs,
    taskWallClockMs: accumulatedWallClockMs,
    resumeCount: params.resumeCount ?? params.existingTaskRun?.resumeCount ?? 0,
    completedAt: status === 'completed' || status === 'failed' || status === 'cancelled' ? new Date() : null,
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
    canModerate = false,
      promptMode = 'standard',
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
    maxRounds: graphConfig.sliceMaxSteps,
  };
  const autopilotMode = resolveRuntimeAutopilotMode({
    invokedBy,
    configuredMode: appConfig.AUTOPILOT_MODE,
  });

  const activeToolNames = resolveActiveToolNames({
    isAdmin,
    canModerate,
    invokedBy,
  });
  const promptEnvelope = buildPromptContextMessages({
    userProfileSummary: params.userProfileSummary,
    currentTurn,
    activeTools: activeToolNames,
    model,
    guildSagePersona,
    replyTarget,
    userText,
    userContent,
    focusedContinuity: focusedContinuityBlock,
    recentTranscript: transcriptBlock,
    voiceContext: liveVoiceContext,
    invokedBy,
    invokerIsAdmin: isAdmin,
    invokerCanModerate: canModerate,
    inGuild: guildId !== null,
    turnMode: isVoiceActive ? 'voice' : 'text',
    autopilotMode,
    graphLimits,
    promptMode,
  });
  const runtimeMessages = promptEnvelope.messages;

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
          promptVersion: promptEnvelope.version,
          promptFingerprint: promptEnvelope.promptFingerprint,
        },
        budgetJson: {
          route: SINGLE_ROUTE_KIND,
          model,
          graphEnabled: activeToolNames.length > 0,
          promptVersion: promptEnvelope.version,
          promptFingerprint: promptEnvelope.promptFingerprint,
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
    | null = null;
  let delivery: RunChatTurnResult['delivery'] = 'response_session';
  let meta: RunChatTurnResult['meta'] | undefined;
  let langSmithRunId: string | null = null;
  let langSmithTraceId: string | null = null;
  let responseSession: RuntimeGraphResult['responseSession'] | undefined;
  let artifactDeliveries: RuntimeGraphResult['artifactDeliveries'] | undefined;
  let completionKind: RuntimeGraphResult['completionKind'] | undefined;
  let stopReason: RuntimeGraphResult['stopReason'] | undefined;
  let waitingState: RuntimeGraphResult['waitingState'] | undefined;
  let compactionState: RuntimeGraphResult['compactionState'] | undefined;
  let runStatus: RunChatTurnResult['status'] | undefined;

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
      userProfileSummary: params.userProfileSummary,
      guildSagePersona,
      focusedContinuity: focusedContinuityBlock,
      recentTranscript: transcriptBlock,
      voiceContext: liveVoiceContext,
      promptMode,
      onStateUpdate: params.onResponseSessionUpdate
        ? async (state) => {
            await params.onResponseSessionUpdate?.({
              replyText: state.replyText,
              delivery: state.deliveryDisposition,
              responseSession: state.responseSession,
              pendingInterrupt: state.pendingInterrupt,
              completionKind: state.completionKind,
              stopReason: state.stopReason,
            });
          }
        : undefined,
      promptVersion: promptEnvelope.version,
      promptFingerprint: promptEnvelope.promptFingerprint,
    });
    finalReplyText = graphResult.replyText;
    files = graphResult.files;
    toolResults = graphResult.toolResults;
    pendingInterrupt = toPendingInterruptSummary(graphResult.pendingInterrupt);
    delivery = graphResult.deliveryDisposition;
    responseSession = graphResult.responseSession;
    artifactDeliveries = graphResult.artifactDeliveries;
    completionKind = graphResult.completionKind;
    stopReason = graphResult.stopReason;
    waitingState = graphResult.waitingState;
    compactionState = graphResult.compactionState;
    runStatus = deriveTaskRunStatus(graphResult);
    meta = await buildRunChatTurnMeta({ pendingInterrupt });
    langSmithRunId = graphResult.langSmithRunId;
    langSmithTraceId = graphResult.langSmithTraceId;
    await persistTaskRunFromGraphResult({
      traceId,
      sourceMessageId: params.messageId,
      guildId,
      channelId,
      userId,
      isAdmin,
      canModerate,
      graphConfig,
      graphResult,
    }).catch((error) => {
      logger.warn({ error, traceId }, 'Failed to persist agent task run state');
    });
    const successfulToolCount = graphResult.toolResults.filter((result) => result.success).length;
    graphBudgetJson = {
      enabled: activeToolNames.length > 0,
      toolsExecuted: graphResult.toolResults.length > 0,
      roundsCompleted: graphResult.roundsCompleted,
      sliceIndex: graphResult.sliceIndex,
      totalRoundsCompleted: graphResult.totalRoundsCompleted,
      completionKind: graphResult.completionKind,
      stopReason: graphResult.stopReason,
      deliveryDisposition: graphResult.deliveryDisposition,
      toolResultCount: graphResult.toolResults.length,
      successfulToolCount,
      deduplicatedCallCount: graphResult.deduplicatedCallCount,
      roundEvents: graphResult.roundEvents,
      finalization: graphResult.finalization,
      responseSession: graphResult.responseSession,
      artifactDeliveries: graphResult.artifactDeliveries,
      contextFrame: graphResult.contextFrame,
      attachmentCount: graphResult.files.length,
      latencyMs: Date.now() - loopStartedAt,
      graphStatus: graphResult.graphStatus,
      pendingInterrupt,
      waitingState: graphResult.waitingState,
      compactionState: graphResult.compactionState,
      yieldReason: graphResult.yieldReason,
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
      promptVersion: promptEnvelope.version,
      promptFingerprint: promptEnvelope.promptFingerprint,
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
          promptVersion: promptEnvelope.version,
          promptFingerprint: promptEnvelope.promptFingerprint,
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
      runId: traceId,
      status: runStatus,
      replyText: '',
      delivery,
      completionKind,
      stopReason,
      waitingState,
      meta,
      responseSession,
      artifactDeliveries,
      compactionState,
      debug: {
        messages: runtimeMessages,
        promptVersion: promptEnvelope.version,
        promptFingerprint: promptEnvelope.promptFingerprint,
      },
    };
  }

  clearToolCaches();
  return {
    runId: traceId,
    status: runStatus,
    replyText: safeFinalReplyText,
    delivery,
    completionKind,
    stopReason,
    waitingState,
    meta,
    responseSession,
    artifactDeliveries,
    compactionState,
    debug: {
      messages: runtimeMessages,
      promptVersion: promptEnvelope.version,
      promptFingerprint: promptEnvelope.promptFingerprint,
    },
    files,
  };
}

export async function attachTaskRunResponseSession(params: {
  threadId: string;
  sourceMessageId?: string | null;
  responseMessageId?: string | null;
  responseSession?: RuntimeGraphResult['responseSession'] | null;
}): Promise<void> {
  const existing = await getAgentTaskRunByThreadId(params.threadId);
  if (!existing) {
    return;
  }

  const mergedResponseSession = params.responseSession
    ? mergeResponseSessionRefs(existing.responseSessionJson, params.responseSession)
    : existing.responseSessionJson;
  const persistedResponseRefs = readPersistedResponseSessionRefs(existing.responseSessionJson);
  const nextLatestText =
    mergedResponseSession &&
    typeof mergedResponseSession === 'object' &&
    !Array.isArray(mergedResponseSession) &&
    typeof (mergedResponseSession as { latestText?: unknown }).latestText === 'string'
      ? ((mergedResponseSession as { latestText?: string }).latestText ?? existing.latestDraftText)
      : existing.latestDraftText;
  const nextDraftRevision =
    mergedResponseSession &&
    typeof mergedResponseSession === 'object' &&
    !Array.isArray(mergedResponseSession) &&
    typeof (mergedResponseSession as { draftRevision?: unknown }).draftRevision === 'number'
      ? ((mergedResponseSession as { draftRevision?: number }).draftRevision ?? existing.draftRevision)
      : existing.draftRevision;
  const mergedResponseRefs = readPersistedResponseSessionRefs(mergedResponseSession);

  await upsertAgentTaskRun({
    threadId: existing.threadId,
    originTraceId: existing.originTraceId,
    latestTraceId: existing.latestTraceId,
    guildId: existing.guildId,
    channelId: existing.channelId,
    requestedByUserId: existing.requestedByUserId,
    sourceMessageId:
      params.sourceMessageId ??
      existing.sourceMessageId ??
      persistedResponseRefs.sourceMessageId,
    responseMessageId:
      params.responseMessageId ??
      mergedResponseRefs.responseMessageId ??
      existing.responseMessageId ??
      persistedResponseRefs.responseMessageId,
    status: existing.status,
    waitingKind: existing.waitingKind,
    latestDraftText: nextLatestText,
    draftRevision: nextDraftRevision,
    completionKind: existing.completionKind,
    stopReason: existing.stopReason,
    nextRunnableAt: existing.nextRunnableAt,
    responseSessionJson: mergedResponseSession,
    waitingStateJson: existing.waitingStateJson,
    compactionStateJson: existing.compactionStateJson,
    checkpointMetadataJson: existing.checkpointMetadataJson,
    maxTotalDurationMs: existing.maxTotalDurationMs,
    maxIdleWaitMs: existing.maxIdleWaitMs,
    taskWallClockMs: existing.taskWallClockMs,
    resumeCount: existing.resumeCount,
    completedAt: existing.completedAt,
    lastErrorText: existing.lastErrorText,
  });
}

export async function resumeWaitingTaskRunWithInput(
  params: ResumeWaitingTaskRunWithInputParams,
): Promise<RunChatTurnResult> {
  const waitingTaskRun = await findWaitingUserInputTaskRun({
    guildId: params.guildId,
    channelId: params.channelId,
    requestedByUserId: params.userId,
    replyToMessageId: params.replyToMessageId ?? null,
  });

  if (!waitingTaskRun) {
    return {
      runId: params.traceId,
      status: 'failed',
      replyText: "I couldn't find the question I was waiting on, so please ask me again.",
      delivery: 'response_session',
      files: [],
    };
  }

  const apiKey = await resolveApiKeyForRuntime(params.guildId);
  if (!apiKey) {
    return buildMissingApiKeyResult(params.guildId);
  }

  const graphConfig = buildAgentGraphConfig();
  const limitKind = resolveTaskRunLimitKind({
    taskRun: waitingTaskRun,
    maxResumes: graphConfig.maxResumes,
  });
  if (limitKind) {
    const replyText = buildTaskRunLimitReply(limitKind);
    await failTaskRunForLimit({
      threadId: waitingTaskRun.threadId,
      replyText,
    });
    return {
      runId: waitingTaskRun.threadId,
      status: 'failed',
      replyText,
      delivery: 'response_session',
      files: [],
    };
  }

  const model = appConfig.AI_PROVIDER_MAIN_AGENT_MODEL.trim();
  const activeToolNames = resolveActiveToolNames({
    isAdmin: params.isAdmin,
    canModerate: params.canModerate ?? false,
    invokedBy: 'reply',
  });

  try {
    const graphResult = await continueAgentGraphTurn({
      threadId: waitingTaskRun.threadId,
      runId: params.traceId,
      runName: 'sage_agent_user_input_resume',
      context: {
        traceId: params.traceId,
        threadId: waitingTaskRun.threadId,
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
        invokedBy: 'reply',
        invokerIsAdmin: params.isAdmin,
        invokerCanModerate: params.canModerate ?? false,
        activeToolNames,
        routeKind: 'user_input_resume',
        currentTurn: params.currentTurn,
        replyTarget: params.replyTarget ?? null,
        promptMode: params.promptMode ?? 'standard',
      },
      appendedMessages: [
        new HumanMessage({
          content: params.userContent ?? params.userText,
        }),
      ],
      clearWaitingState: true,
      onStateUpdate: params.onResponseSessionUpdate
        ? async (state) => {
            await params.onResponseSessionUpdate?.({
              replyText: state.replyText,
              delivery: state.deliveryDisposition,
              responseSession: state.responseSession,
              pendingInterrupt: state.pendingInterrupt,
              completionKind: state.completionKind,
              stopReason: state.stopReason,
            });
          }
        : undefined,
    });

    await persistTaskRunFromGraphResult({
      traceId: waitingTaskRun.threadId,
      sourceMessageId: waitingTaskRun.sourceMessageId ?? params.currentTurn.messageId,
      guildId: params.guildId,
      channelId: params.channelId,
      userId: params.userId,
      isAdmin: params.isAdmin,
      canModerate: params.canModerate,
      graphConfig,
      graphResult,
      existingTaskRun: waitingTaskRun,
      resumeCount: waitingTaskRun.resumeCount + 1,
    });

    return {
      runId: waitingTaskRun.threadId,
      status: deriveTaskRunStatus(graphResult),
      replyText: graphResult.replyText,
      delivery: graphResult.deliveryDisposition,
      completionKind: graphResult.completionKind,
      stopReason: graphResult.stopReason,
      waitingState: graphResult.waitingState,
      responseSession: graphResult.responseSession,
      artifactDeliveries: graphResult.artifactDeliveries,
      compactionState: graphResult.compactionState,
      files: graphResult.files,
      meta: await buildRunChatTurnMeta({
        pendingInterrupt: toPendingInterruptSummary(graphResult.pendingInterrupt),
      }),
    };
  } catch (error) {
    return {
      runId: waitingTaskRun.threadId,
      status: 'failed',
      replyText: buildRuntimeFailureReply({
        kind: 'background_resume',
        category: classifyGraphFailure(error),
      }),
      delivery: 'response_session',
      meta: buildRetryMeta(waitingTaskRun.threadId, 'background_resume'),
      files: [],
    };
  }
}

export async function resumeBackgroundTaskRun(params: {
  traceId: string;
  threadId: string;
  leaseOwner?: string | null;
  userId: string;
  channelId: string;
  guildId: string | null;
  isAdmin: boolean;
  canModerate?: boolean;
  onResponseSessionUpdate?: RunChatTurnParams['onResponseSessionUpdate'];
}): Promise<RunChatTurnResult> {
  const apiKey = await resolveApiKeyForRuntime(params.guildId);
  if (!apiKey) {
    return buildMissingApiKeyResult(params.guildId);
  }

  const taskRun = await getAgentTaskRunByThreadId(params.threadId);
  if (!taskRun) {
    return {
      runId: params.threadId,
      status: 'failed',
      replyText: 'I couldn’t pick that task back up, so please ask me again.',
      delivery: 'response_session',
      files: [],
    };
  }

  const model = appConfig.AI_PROVIDER_MAIN_AGENT_MODEL.trim();
  const graphConfig = buildAgentGraphConfig();
  const limitKind = resolveTaskRunLimitKind({
    taskRun,
    maxResumes: graphConfig.maxResumes,
  });
  if (limitKind) {
    const replyText = buildTaskRunLimitReply(limitKind);
    await failTaskRunForLimit({
      threadId: taskRun.threadId,
      replyText,
    });
    await releaseAgentTaskRunLease({
      id: taskRun.id,
      leaseOwner: params.leaseOwner ?? taskRun.leaseOwner ?? '',
    }).catch(() => undefined);
    return {
      runId: params.threadId,
      status: 'failed',
      replyText,
      delivery: 'response_session',
      files: [],
    };
  }

  const activeToolNames = resolveActiveToolNames({
    isAdmin: params.isAdmin,
    canModerate: params.canModerate ?? false,
    invokedBy: 'component',
  });
  try {
    const graphResult = await continueAgentGraphTurn({
      threadId: params.threadId,
      runId: params.traceId,
      runName: 'sage_agent_background_resume',
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
        routeKind: 'background_resume',
      },
      onStateUpdate: params.onResponseSessionUpdate
        ? async (state) => {
            await params.onResponseSessionUpdate?.({
              replyText: state.replyText,
              delivery: state.deliveryDisposition,
              responseSession: state.responseSession,
              pendingInterrupt: state.pendingInterrupt,
              completionKind: state.completionKind,
              stopReason: state.stopReason,
            });
          }
        : undefined,
    });

    await persistTaskRunFromGraphResult({
      traceId: params.threadId,
      sourceMessageId: taskRun.sourceMessageId ?? params.threadId,
      guildId: params.guildId,
      channelId: params.channelId,
      userId: params.userId,
      isAdmin: params.isAdmin,
      canModerate: params.canModerate,
      graphConfig,
      graphResult,
      existingTaskRun: taskRun,
      resumeCount: taskRun.resumeCount + 1,
    });
    await releaseAgentTaskRunLease({
      id: taskRun.id,
      leaseOwner: params.leaseOwner ?? taskRun.leaseOwner ?? '',
    }).catch(() => undefined);

    return {
      runId: params.threadId,
      status: deriveTaskRunStatus(graphResult),
      replyText: graphResult.replyText,
      delivery: graphResult.deliveryDisposition,
      completionKind: graphResult.completionKind,
      stopReason: graphResult.stopReason,
      waitingState: graphResult.waitingState,
      responseSession: graphResult.responseSession,
      artifactDeliveries: graphResult.artifactDeliveries,
      compactionState: graphResult.compactionState,
      files: graphResult.files,
      meta: await buildRunChatTurnMeta({ pendingInterrupt: toPendingInterruptSummary(graphResult.pendingInterrupt) }),
    };
  } catch (error) {
    await releaseAgentTaskRunLease({
      id: taskRun.id,
      leaseOwner: params.leaseOwner ?? taskRun.leaseOwner ?? '',
    }).catch(() => undefined);

    return {
      runId: params.threadId,
      status: 'failed',
      replyText: buildRuntimeFailureReply({
        kind: 'background_resume',
        category: classifyGraphFailure(error),
      }),
      delivery: 'response_session',
      meta: buildRetryMeta(params.threadId, 'background_resume'),
      files: [],
    };
  }
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
  const routeKind = params.retryKind === 'background_resume' ? 'background_retry' : 'turn_retry';

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
      runName: params.retryKind === 'background_resume' ? 'sage_agent_background_retry' : 'sage_agent_turn_retry',
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
      runId: params.threadId,
      status: deriveTaskRunStatus(graphResult),
      replyText,
      delivery: graphResult.deliveryDisposition,
      completionKind: graphResult.completionKind,
      stopReason: graphResult.stopReason,
      waitingState: graphResult.waitingState,
      meta: await buildRunChatTurnMeta({ pendingInterrupt }),
      files: graphResult.files,
      responseSession: graphResult.responseSession,
      artifactDeliveries: graphResult.artifactDeliveries,
      compactionState: graphResult.compactionState,
    };

    if (appConfig.SAGE_TRACE_DB_ENABLED) {
      await updateTraceEnd({
        id: params.traceId,
        toolJson: {
          enabled: activeToolNames.length > 0,
          graph: {
            roundsCompleted: graphResult.roundsCompleted,
            sliceIndex: graphResult.sliceIndex,
            totalRoundsCompleted: graphResult.totalRoundsCompleted,
            completionKind: graphResult.completionKind,
            stopReason: graphResult.stopReason,
            deliveryDisposition: graphResult.deliveryDisposition,
            responseSession: graphResult.responseSession,
            artifactDeliveries: graphResult.artifactDeliveries,
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
            sliceIndex: graphResult.sliceIndex,
            totalRoundsCompleted: graphResult.totalRoundsCompleted,
            completionKind: graphResult.completionKind,
            stopReason: graphResult.stopReason,
            deliveryDisposition: graphResult.deliveryDisposition,
            responseSession: graphResult.responseSession,
            artifactDeliveries: graphResult.artifactDeliveries,
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
      runId: params.threadId,
      status: 'failed',
      replyText,
      delivery: 'response_session',
      meta: buildRetryMeta(params.threadId, params.retryKind),
      files: [],
    };
  }
}
