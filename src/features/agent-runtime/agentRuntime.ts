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
import { buildAgentGraphConfig } from './langgraph/config';
import { resolveTextProviderRoute } from './apiKeyResolver';
import { continueAgentGraphTurn, retryAgentGraphTurn, runAgentGraphTurn } from './langgraph/runtime';
import {
  buildTaskRunLimitReply,
  buildRuntimeFailureReply,
  type RuntimeFailureCategory,
} from './visibleReply';
import {
  buildPromptContextMessages,
  type PromptInputMode,
  type PromptWaitingFollowUp,
} from './promptContract';
import {
  findWaitingUserInputTaskRun,
  getAgentTaskRunByThreadId,
  type AgentTaskRunStatus,
  type QueueRunningTaskRunActiveInterruptResult,
  queueRunningTaskRunActiveInterrupt,
  readActiveUserInterruptState,
  upsertAgentTaskRun,
  updateAgentTaskRunByThreadId,
} from './agentTaskRunRepo';
import {
  CurrentTurnContext,
  ReplyTargetContext,
  selectFocusedContinuityMessages,
} from './continuityContext';
import { resolveRuntimeAutopilotMode } from './autopilotMode';
import { resolveRuntimeSurfaceToolNames } from './runtimeSurface';
import type { GraphDeliveryDisposition, GraphWaitingState } from './langgraph/types';
import {
  type DiscordAuthorityTier,
} from '../../platform/discord/admin-permissions';
import { AppError } from '../../shared/errors/app-error';

const SINGLE_ROUTE_KIND = 'single';

export interface RunChatTurnParams {
  traceId: string;
  userId: string;
  originChannelId: string;
  responseChannelId: string;
  guildId: string | null;
  messageId: string;
  userText: string;
  userContent?: LLMMessageContent;
  userProfileSummary: string | null;
  currentTurn: CurrentTurnContext;
  replyTarget?: ReplyTargetContext | null;
  mentionedUserIds?: string[];
  invokedBy?: 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';
  invokerAuthority?: DiscordAuthorityTier;
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
  tokenUsage?: RuntimeGraphResult['tokenUsage'];
}

export interface ResumeWaitingTaskRunWithInputParams {
  traceId: string;
  userId: string;
  originChannelId: string;
  responseChannelId: string;
  guildId: string | null;
  replyToMessageId?: string | null;
  userText: string;
  userContent?: LLMMessageContent;
  currentTurn: CurrentTurnContext;
  replyTarget?: ReplyTargetContext | null;
  promptMode?: PromptInputMode;
  invokerAuthority: DiscordAuthorityTier;
  isAdmin: boolean;
  canModerate?: boolean;
  onResponseSessionUpdate?: RunChatTurnParams['onResponseSessionUpdate'];
}

export interface QueueRunningTaskRunActiveInterruptParams {
  threadId: string;
  userId: string;
  channelId: string;
  guildId: string | null;
  messageId: string;
  userText: string;
  userContent?: LLMMessageContent;
}

export type QueueActiveRunUserInterruptResult = QueueRunningTaskRunActiveInterruptResult;

export interface ContinueMatchedTaskRunWithInputParams {
  traceId: string;
  threadId: string;
  userId: string;
  originChannelId: string;
  responseChannelId: string;
  guildId: string | null;
  userText: string;
  userContent?: LLMMessageContent;
  currentTurn: CurrentTurnContext;
  replyTarget?: ReplyTargetContext | null;
  promptMode?: PromptInputMode;
  invokerAuthority: DiscordAuthorityTier;
  isAdmin: boolean;
  canModerate?: boolean;
  onResponseSessionUpdate?: RunChatTurnParams['onResponseSessionUpdate'];
}

export interface RetryFailedChatTurnParams {
  traceId: string;
  threadId: string;
  userId: string;
  originChannelId: string;
  responseChannelId: string;
  guildId: string | null;
  retryKind: 'turn' | 'background_resume';
  invokerAuthority: DiscordAuthorityTier;
  isAdmin: boolean;
  canModerate?: boolean;
}

type ToolInvocationKind = 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';

function resolveActiveToolNames(params: {
  authority: DiscordAuthorityTier;
  invokedBy: ToolInvocationKind;
}): string[] {
  return resolveRuntimeSurfaceToolNames({
    authority: params.authority,
    invokedBy: params.invokedBy,
  });
}

function classifyGraphFailure(error: unknown): RuntimeFailureCategory {
  if (error instanceof AppError) {
    switch (error.code) {
      case 'AI_PROVIDER_AUTH':
        return 'provider_auth';
      case 'AI_PROVIDER_ENDPOINT':
        return 'provider_config';
      case 'AI_PROVIDER_MODEL':
      case 'AI_PROVIDER_BAD_REQUEST':
        return 'provider_model';
      case 'AI_PROVIDER_RATE_LIMIT':
        return 'provider_rate_limit';
      case 'AI_PROVIDER_TIMEOUT':
        return 'provider_timeout';
      case 'AI_PROVIDER_NETWORK':
      case 'AI_PROVIDER_UPSTREAM':
        return 'provider_network';
      default:
        return 'runtime';
    }
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

function readWaitingFollowUpPrompt(waitingTaskRun: {
  waitingStateJson: unknown;
  latestDraftText: string;
}): string {
  const candidate = waitingTaskRun.waitingStateJson;
  if (
    candidate &&
    typeof candidate === 'object' &&
    !Array.isArray(candidate) &&
    typeof (candidate as { prompt?: unknown }).prompt === 'string'
  ) {
    const prompt = ((candidate as { prompt?: string }).prompt ?? '').trim();
    if (prompt.length > 0) {
      return prompt;
    }
  }
  return waitingTaskRun.latestDraftText.trim();
}

function buildWaitingFollowUpContext(params: {
  waitingTaskRun: {
    sourceMessageId: string | null;
    responseMessageId: string | null;
    waitingStateJson: unknown;
    latestDraftText: string;
  };
}): PromptWaitingFollowUp {
  return {
    matched: true,
    matchKind: 'direct_reply',
    outstandingPrompt: readWaitingFollowUpPrompt(params.waitingTaskRun),
    responseMessageId: params.waitingTaskRun.responseMessageId ?? null,
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
  surfaceAttached: boolean;
  overflowMessageIds: string[];
};

function readPersistedResponseSessionRefs(value: unknown): PersistedResponseSessionRefs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      sourceMessageId: null,
      responseMessageId: null,
      surfaceAttached: false,
      overflowMessageIds: [],
    };
  }

  const record = value as Record<string, unknown>;
  return {
    sourceMessageId: typeof record.sourceMessageId === 'string' ? record.sourceMessageId : null,
    responseMessageId: typeof record.responseMessageId === 'string' ? record.responseMessageId : null,
    surfaceAttached: record.surfaceAttached === true,
    overflowMessageIds: Array.isArray(record.overflowMessageIds)
      ? record.overflowMessageIds.filter((value): value is string => typeof value === 'string')
      : [],
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
    surfaceAttached: nextValue?.surfaceAttached ?? existingRefs.surfaceAttached,
    overflowMessageIds: nextValue?.overflowMessageIds ?? existingRefs.overflowMessageIds,
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
  if (graphResult.completionKind === 'user_input_pending') {
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

async function failTaskRunAfterBackgroundResumeError(params: {
  taskRun: Awaited<ReturnType<typeof getAgentTaskRunByThreadId>>;
  replyText: string;
}): Promise<void> {
  if (!params.taskRun) {
    return;
  }

  const existingResponseSession =
    params.taskRun.responseSessionJson &&
    typeof params.taskRun.responseSessionJson === 'object' &&
    !Array.isArray(params.taskRun.responseSessionJson)
      ? (params.taskRun.responseSessionJson as Record<string, unknown>)
      : null;

  await updateAgentTaskRunByThreadId({
    threadId: params.taskRun.threadId,
    status: 'failed',
    waitingKind: null,
    latestDraftText: params.replyText,
    completionKind: 'runtime_failure',
    stopReason: 'runtime_failure',
    nextRunnableAt: null,
    completedAt: new Date(),
    lastErrorText: params.replyText,
    responseSessionJson: existingResponseSession
      ? {
          ...existingResponseSession,
          latestText: params.replyText,
          status: 'failed',
        }
      : params.taskRun.responseSessionJson,
  }).catch((error) => {
    logger.warn(
      { error, threadId: params.taskRun?.threadId },
      'Failed to mark task run as failed after a background resume error',
    );
  });
}

function toContinuePendingUserInterrupt(taskRun: Awaited<ReturnType<typeof getAgentTaskRunByThreadId>> | null) {
  const activeInterrupt = taskRun ? readActiveUserInterruptState(taskRun) : null;
  if (!activeInterrupt || activeInterrupt.revision <= activeInterrupt.consumedRevision) {
    return null;
  }

  return {
    revision: activeInterrupt.revision,
    messageId: activeInterrupt.payload.messageId,
    userId: activeInterrupt.payload.userId,
    channelId: activeInterrupt.payload.channelId,
    guildId: activeInterrupt.payload.guildId,
    userText: activeInterrupt.payload.userText,
    userContent: activeInterrupt.payload.userContent,
    queuedAtIso: activeInterrupt.queuedAt?.toISOString() ?? null,
    supersededRevision: activeInterrupt.supersededRevision ?? null,
  };
}

function readConsumedActiveInterruptRevision(graphResult: RuntimeGraphResult): number | null {
  return graphResult.interruptResolution?.kind === 'user_steer'
    ? graphResult.interruptResolution.revision
    : null;
}

async function persistTaskRunFromGraphResult(params: {
  traceId: string;
  sourceMessageId: string | null;
  guildId: string | null;
  originChannelId: string;
  responseChannelId: string;
  userId: string;
  invokerAuthority?: DiscordAuthorityTier;
  isAdmin?: boolean;
  canModerate?: boolean;
  graphConfig: ReturnType<typeof buildAgentGraphConfig>;
  graphResult: RuntimeGraphResult;
  existingTaskRun?: Awaited<ReturnType<typeof getAgentTaskRunByThreadId>> | null;
  resumeCount?: number;
  freshResponseSurface?: boolean;
  consumedActiveInterruptRevisionOverride?: number | null;
}): Promise<{
  persistedStatus: RunChatTurnResult['status'];
  deferredForActiveInterrupt: boolean;
}> {
  const latestTaskRun = await getAgentTaskRunByThreadId(params.traceId);
  const existingTaskRun = latestTaskRun ?? params.existingTaskRun ?? null;
  const status = deriveTaskRunStatus(params.graphResult);
  const consumedActiveInterruptRevision =
    params.consumedActiveInterruptRevisionOverride ?? readConsumedActiveInterruptRevision(params.graphResult);
  const existingActiveInterrupt = existingTaskRun ? readActiveUserInterruptState(existingTaskRun) : null;
  const nextConsumedActiveInterruptRevision =
    consumedActiveInterruptRevision === null
      ? existingTaskRun?.activeUserInterruptConsumedRevision ?? 0
      : Math.max(existingTaskRun?.activeUserInterruptConsumedRevision ?? 0, consumedActiveInterruptRevision);
  const deferTerminalCompletionForActiveInterrupt =
    status === 'completed' &&
    !!existingActiveInterrupt &&
    existingActiveInterrupt.revision > nextConsumedActiveInterruptRevision;
  const mergedResponseSessionBase = mergeResponseSessionRefs(
    existingTaskRun?.responseSessionJson,
    params.graphResult.responseSession,
  );
  const persistedResponseRefs = readPersistedResponseSessionRefs(existingTaskRun?.responseSessionJson);
  const mergedResponseSession = params.freshResponseSurface
    ? {
        ...mergedResponseSessionBase,
        sourceMessageId: params.sourceMessageId ?? params.graphResult.responseSession.sourceMessageId ?? null,
        responseMessageId: params.graphResult.responseSession.responseMessageId ?? null,
        surfaceAttached: params.graphResult.responseSession.surfaceAttached ?? false,
        overflowMessageIds: params.graphResult.responseSession.overflowMessageIds ?? [],
      }
    : mergedResponseSessionBase;
  const persistedResponseSession =
    deferTerminalCompletionForActiveInterrupt && existingTaskRun
      ? {
          ...mergedResponseSession,
          latestText: existingTaskRun.latestDraftText,
          draftRevision: existingTaskRun.draftRevision,
          status: 'draft' as const,
        }
      : mergedResponseSession;
  const runningResponseSurfaceReady =
    persistedResponseSession.surfaceAttached === true ||
    typeof persistedResponseSession.responseMessageId === 'string' ||
    (!params.freshResponseSurface &&
      (typeof existingTaskRun?.responseMessageId === 'string' ||
        typeof persistedResponseRefs.responseMessageId === 'string'));
  const accumulatedWallClockMs =
    (existingTaskRun?.taskWallClockMs ?? 0) +
    Math.max(0, Math.trunc(params.graphResult.activeWindowDurationMs ?? 0));
  const persistedStatus = deferTerminalCompletionForActiveInterrupt ? 'running' : status;
  await upsertAgentTaskRun({
    threadId: params.traceId,
    originTraceId: existingTaskRun?.originTraceId ?? params.traceId,
    latestTraceId: params.graphResult.langSmithTraceId ?? params.traceId,
    guildId: existingTaskRun?.guildId ?? params.guildId,
    originChannelId: existingTaskRun?.originChannelId ?? params.originChannelId,
    responseChannelId: existingTaskRun?.responseChannelId ?? params.responseChannelId,
    requestedByUserId: existingTaskRun?.requestedByUserId ?? params.userId,
    sourceMessageId:
      params.freshResponseSurface
        ? persistedResponseSession.sourceMessageId ?? params.sourceMessageId
        : existingTaskRun?.sourceMessageId ??
          persistedResponseSession.sourceMessageId ??
          persistedResponseRefs.sourceMessageId ??
          params.sourceMessageId,
    responseMessageId:
      params.freshResponseSurface
        ? persistedResponseSession.responseMessageId
        : persistedResponseSession.responseMessageId ??
          existingTaskRun?.responseMessageId ??
          persistedResponseRefs.responseMessageId,
    status:
      persistedStatus === 'waiting_approval'
        ? 'waiting_approval'
        : persistedStatus === 'waiting_user_input'
          ? 'waiting_user_input'
          : persistedStatus === 'running'
            ? 'running'
            : persistedStatus === 'failed'
              ? 'failed'
              : persistedStatus === 'cancelled'
                ? 'cancelled'
                : 'completed',
    waitingKind:
      persistedStatus === 'waiting_approval'
        ? 'approval_review'
        : persistedStatus === 'waiting_user_input'
          ? 'user_input'
          : null,
    latestDraftText: persistedResponseSession.latestText || params.graphResult.replyText,
    draftRevision: persistedResponseSession.draftRevision,
    completionKind: deferTerminalCompletionForActiveInterrupt ? null : params.graphResult.completionKind,
    stopReason: deferTerminalCompletionForActiveInterrupt ? null : params.graphResult.stopReason,
    nextRunnableAt:
      persistedStatus === 'running'
        ? runningResponseSurfaceReady
          ? new Date(Date.now() + params.graphConfig.workerPollMs)
          : null
        : null,
    responseSessionJson: persistedResponseSession,
    waitingStateJson: params.graphResult.waitingState ?? null,
    compactionStateJson: params.graphResult.compactionState ?? null,
    checkpointMetadataJson: {
      yieldReason: params.graphResult.yieldReason,
      sliceIndex: params.graphResult.sliceIndex,
      totalRoundsCompleted: params.graphResult.totalRoundsCompleted,
      plainTextOutcomeSource: params.graphResult.plainTextOutcomeSource,
      deferredForActiveInterrupt: deferTerminalCompletionForActiveInterrupt,
      invokerAuthority: params.invokerAuthority ?? (params.isAdmin ? 'admin' : params.canModerate ? 'moderator' : 'member'),
      isAdmin: params.isAdmin ?? false,
      canModerate: params.canModerate ?? false,
    },
    activeUserInterruptJson: existingTaskRun?.activeUserInterruptJson ?? null,
    activeUserInterruptRevision: existingTaskRun?.activeUserInterruptRevision ?? 0,
    activeUserInterruptConsumedRevision: nextConsumedActiveInterruptRevision,
    activeUserInterruptQueuedAt: existingTaskRun?.activeUserInterruptQueuedAt ?? null,
    activeUserInterruptConsumedAt:
      consumedActiveInterruptRevision === null
        ? existingTaskRun?.activeUserInterruptConsumedAt ?? null
        : new Date(),
    activeUserInterruptSupersededAt: existingTaskRun?.activeUserInterruptSupersededAt ?? null,
    activeUserInterruptSupersededRevision: existingTaskRun?.activeUserInterruptSupersededRevision ?? null,
    maxTotalDurationMs: existingTaskRun?.maxTotalDurationMs ?? params.graphConfig.maxTotalDurationMs,
    maxIdleWaitMs: existingTaskRun?.maxIdleWaitMs ?? params.graphConfig.maxIdleWaitMs,
    taskWallClockMs: accumulatedWallClockMs,
    resumeCount: params.resumeCount ?? existingTaskRun?.resumeCount ?? 0,
    completedAt:
      persistedStatus === 'completed' || persistedStatus === 'failed' || persistedStatus === 'cancelled'
        ? new Date()
        : null,
  });

  return {
    persistedStatus,
    deferredForActiveInterrupt: deferTerminalCompletionForActiveInterrupt,
  };
}

export async function runChatTurn(params: RunChatTurnParams): Promise<RunChatTurnResult> {
  const {
    traceId,
    userId,
    originChannelId,
    responseChannelId,
    guildId,
    userText,
    userContent,
    currentTurn,
    replyTarget,
    invokedBy = 'mention',
    isAdmin = false,
    canModerate = false,
    invokerAuthority = isAdmin ? 'admin' : canModerate ? 'moderator' : 'member',
    promptMode = 'standard',
  } = params;
  const clearToolCaches = () => {
  };

  const recentMessages =
    guildId && isLoggingEnabled(guildId, responseChannelId)
      ? getRecentMessages({ guildId, channelId: responseChannelId, limit: appConfig.CONTEXT_TRANSCRIPT_MAX_MESSAGES })
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

  const runtimeRoute = await resolveTextProviderRoute(guildId, 'main');
  const apiKey = runtimeRoute.apiKey;
  if (!apiKey) {
    logger.warn(
      { guildId, channelId: responseChannelId, userId, originChannelId },
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
  const model = runtimeRoute.model;
  const graphConfig = buildAgentGraphConfig();
  const graphLimits = {
    maxRounds: graphConfig.sliceMaxSteps,
  };
  const autopilotMode = resolveRuntimeAutopilotMode({
    invokedBy,
    configuredMode: appConfig.AUTOPILOT_MODE,
  });

  const activeToolNames = resolveActiveToolNames({
    authority: invokerAuthority,
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
    invokedBy,
    invokerAuthority,
    invokerIsAdmin: isAdmin,
    invokerCanModerate: canModerate,
    inGuild: guildId !== null,
    autopilotMode,
    graphLimits,
    promptMode,
  });
  const promptMessages = promptEnvelope.messages;
  const conversationMessages: BaseMessage[] = [
    new HumanMessage({
      content: userContent ?? userText,
    }),
  ];

  if (appConfig.SAGE_TRACE_DB_ENABLED) {
    try {
      await upsertTraceStart({
        id: traceId,
        guildId,
        channelId: responseChannelId,
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
  let tokenUsage: RuntimeGraphResult['tokenUsage'] | undefined;
  let runStatus: RunChatTurnResult['status'] | undefined;

  try {
    const loopStartedAt = Date.now();
    const graphResult = await runAgentGraphTurn({
      traceId,
      userId,
      channelId: responseChannelId,
      originChannelId,
      responseChannelId,
      guildId,
      providerId: runtimeRoute.providerId,
      baseUrl: runtimeRoute.baseUrl,
      apiKey,
      apiKeySource: runtimeRoute.authSource,
      fallbackRoute: runtimeRoute.fallbackRoute,
      model,
      temperature: 0.6,
      timeoutMs: appConfig.TIMEOUT_CHAT_MS,
      maxTokens: normalizeStrictlyPositiveInt(
        appConfig.AGENT_GRAPH_MAX_OUTPUT_TOKENS as number | undefined,
        1_800,
      ),
      messages: conversationMessages,
      activeToolNames,
      routeKind: SINGLE_ROUTE_KIND,
      currentTurn,
      replyTarget,
      invokedBy,
      invokerAuthority,
      invokerIsAdmin: isAdmin,
      invokerCanModerate: canModerate,
      userProfileSummary: params.userProfileSummary,
      guildSagePersona,
      focusedContinuity: focusedContinuityBlock,
      recentTranscript: transcriptBlock,
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
    pendingInterrupt = toPendingInterruptSummary(graphResult.pendingInterrupt);
    delivery = graphResult.deliveryDisposition;
    responseSession = graphResult.responseSession;
    artifactDeliveries = graphResult.artifactDeliveries;
    completionKind = graphResult.completionKind;
    stopReason = graphResult.stopReason;
    waitingState = graphResult.waitingState;
    compactionState = graphResult.compactionState;
    tokenUsage = graphResult.tokenUsage;
    runStatus = deriveTaskRunStatus(graphResult);
    meta = await buildRunChatTurnMeta({ pendingInterrupt });
    langSmithRunId = graphResult.langSmithRunId;
    langSmithTraceId = graphResult.langSmithTraceId;
    await persistTaskRunFromGraphResult({
      traceId,
      sourceMessageId: params.messageId,
      guildId,
      originChannelId,
      responseChannelId,
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
      tokenUsage: graphResult.tokenUsage,
      plainTextOutcomeSource: graphResult.plainTextOutcomeSource,
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
  const groundedReplyText = finalReplyText;
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
      tokenUsage,
      debug: {
        messages: promptMessages,
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
      tokenUsage,
    debug: {
      messages: promptMessages,
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
  requestedByUserId?: string | null;
  originChannelId?: string;
  responseChannelId?: string;
  guildId?: string | null;
  originTraceId?: string | null;
  latestTraceId?: string | null;
  statusIfMissing?: AgentTaskRunStatus;
}): Promise<void> {
  const existing = await getAgentTaskRunByThreadId(params.threadId);
  const graphConfig = buildAgentGraphConfig();

  if (!existing) {
    if (!params.requestedByUserId || !params.originChannelId || !params.responseChannelId) {
      return;
    }

    const nextResponseSession =
      params.responseSession &&
      typeof params.responseSession === 'object' &&
      !Array.isArray(params.responseSession)
        ? {
            ...params.responseSession,
            sourceMessageId:
              params.responseSession.sourceMessageId ?? params.sourceMessageId ?? null,
            responseMessageId:
              params.responseSession.responseMessageId ?? params.responseMessageId ?? null,
            surfaceAttached:
              typeof params.responseMessageId === 'string'
                ? true
                : params.responseSession.surfaceAttached === true,
          }
        : params.responseSession;
    const nextDraftText =
      nextResponseSession &&
      typeof nextResponseSession === 'object' &&
      !Array.isArray(nextResponseSession) &&
      typeof (nextResponseSession as { latestText?: unknown }).latestText === 'string'
        ? (((nextResponseSession as { latestText?: string }).latestText ?? '').trim() || '')
        : '';
    const nextDraftRevision =
      nextResponseSession &&
      typeof nextResponseSession === 'object' &&
      !Array.isArray(nextResponseSession) &&
      typeof (nextResponseSession as { draftRevision?: unknown }).draftRevision === 'number'
        ? ((nextResponseSession as { draftRevision?: number }).draftRevision ?? 0)
        : 0;

    await upsertAgentTaskRun({
      threadId: params.threadId,
      originTraceId: params.originTraceId ?? params.threadId,
      latestTraceId: params.latestTraceId ?? params.threadId,
      guildId: params.guildId ?? null,
      originChannelId: params.originChannelId,
      responseChannelId: params.responseChannelId,
      requestedByUserId: params.requestedByUserId,
      sourceMessageId:
        params.sourceMessageId ??
        (nextResponseSession &&
        typeof nextResponseSession === 'object' &&
        !Array.isArray(nextResponseSession)
          ? (((nextResponseSession as { sourceMessageId?: string | null }).sourceMessageId ?? null) as
              | string
              | null)
          : null),
      responseMessageId:
        params.responseMessageId ??
        (nextResponseSession &&
        typeof nextResponseSession === 'object' &&
        !Array.isArray(nextResponseSession)
          ? (((nextResponseSession as { responseMessageId?: string | null }).responseMessageId ?? null) as
              | string
              | null)
          : null),
      status: params.statusIfMissing ?? 'running',
      waitingKind: null,
      latestDraftText: nextDraftText,
      draftRevision: nextDraftRevision,
      completionKind: null,
      stopReason: null,
      nextRunnableAt: null,
      responseSessionJson: nextResponseSession,
      waitingStateJson: null,
      compactionStateJson: null,
      checkpointMetadataJson: null,
      maxTotalDurationMs: graphConfig.maxTotalDurationMs,
      maxIdleWaitMs: graphConfig.maxIdleWaitMs,
      taskWallClockMs: 0,
      resumeCount: 0,
      completedAt: null,
      lastErrorText: null,
    });
    return;
  }

  const mergedResponseSession = params.responseSession
    ? mergeResponseSessionRefs(existing.responseSessionJson, params.responseSession)
    : existing.responseSessionJson;
  const persistedResponseRefs = readPersistedResponseSessionRefs(existing.responseSessionJson);
  const nextResponseSession =
    mergedResponseSession && typeof mergedResponseSession === 'object' && !Array.isArray(mergedResponseSession)
      ? {
          ...mergedResponseSession,
          surfaceAttached:
            typeof params.responseMessageId === 'string'
              ? true
              : ((mergedResponseSession as { surfaceAttached?: unknown }).surfaceAttached ?? persistedResponseRefs.surfaceAttached) === true,
        }
      : mergedResponseSession;
  const nextLatestText =
    nextResponseSession &&
    typeof nextResponseSession === 'object' &&
    !Array.isArray(nextResponseSession) &&
    typeof (nextResponseSession as { latestText?: unknown }).latestText === 'string'
      ? ((nextResponseSession as { latestText?: string }).latestText ?? existing.latestDraftText)
      : existing.latestDraftText;
  const nextDraftRevision =
    nextResponseSession &&
    typeof nextResponseSession === 'object' &&
    !Array.isArray(nextResponseSession) &&
    typeof (nextResponseSession as { draftRevision?: unknown }).draftRevision === 'number'
      ? ((nextResponseSession as { draftRevision?: number }).draftRevision ?? existing.draftRevision)
      : existing.draftRevision;
  const mergedResponseRefs = readPersistedResponseSessionRefs(nextResponseSession);
  await upsertAgentTaskRun({
    threadId: existing.threadId,
    originTraceId: existing.originTraceId,
    latestTraceId: existing.latestTraceId,
    guildId: existing.guildId,
    originChannelId: existing.originChannelId,
    responseChannelId: existing.responseChannelId,
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
    nextRunnableAt:
      existing.status === 'running' &&
      typeof params.responseMessageId === 'string' &&
      existing.nextRunnableAt === null
        ? new Date(Date.now() + graphConfig.workerPollMs)
        : existing.nextRunnableAt,
    responseSessionJson: nextResponseSession,
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

export async function queueActiveRunUserInterrupt(
  params: QueueRunningTaskRunActiveInterruptParams,
): Promise<QueueActiveRunUserInterruptResult> {
  return await queueRunningTaskRunActiveInterrupt({
    threadId: params.threadId,
    requestedByUserId: params.userId,
    guildId: params.guildId,
    channelId: params.channelId,
    messageId: params.messageId,
    userText: params.userText,
    userContent: params.userContent,
  });
}

export async function resumeWaitingTaskRunWithInput(
  params: ResumeWaitingTaskRunWithInputParams,
): Promise<RunChatTurnResult> {
  const waitingTaskRun = await findWaitingUserInputTaskRun({
    guildId: params.guildId,
    channelId: params.responseChannelId,
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

  const runtimeRoute = await resolveTextProviderRoute(params.guildId, 'main');
  if (!runtimeRoute.apiKey) {
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

  const model = runtimeRoute.model;
  const activeToolNames = resolveActiveToolNames({
    authority: params.invokerAuthority,
    invokedBy: 'reply',
  });
  const waitingFollowUp = buildWaitingFollowUpContext({
    waitingTaskRun,
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
        channelId: params.responseChannelId,
        originChannelId: params.originChannelId,
        responseChannelId: params.responseChannelId,
        guildId: params.guildId,
        providerId: runtimeRoute.providerId,
        baseUrl: runtimeRoute.baseUrl,
        apiKey: runtimeRoute.apiKey,
        apiKeySource: runtimeRoute.authSource,
        fallbackRoute: runtimeRoute.fallbackRoute,
        model,
        temperature: 0.6,
        timeoutMs: appConfig.TIMEOUT_CHAT_MS,
        maxTokens: normalizeStrictlyPositiveInt(
          appConfig.AGENT_GRAPH_MAX_OUTPUT_TOKENS as number | undefined,
          1_800,
        ),
        invokedBy: 'reply',
        invokerAuthority: params.invokerAuthority,
        invokerIsAdmin: params.isAdmin,
        invokerCanModerate: params.canModerate ?? false,
        activeToolNames,
        routeKind: 'user_input_resume',
        currentTurn: params.currentTurn,
        replyTarget: params.replyTarget ?? null,
        promptMode: 'waiting_follow_up',
        waitingFollowUp,
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
      sourceMessageId: params.currentTurn.messageId,
      guildId: params.guildId,
      originChannelId: params.originChannelId,
      responseChannelId: params.responseChannelId,
      userId: params.userId,
      invokerAuthority: params.invokerAuthority,
      isAdmin: params.isAdmin,
      canModerate: params.canModerate,
      graphConfig,
      graphResult,
      existingTaskRun: waitingTaskRun,
      resumeCount: waitingTaskRun.resumeCount + 1,
      freshResponseSurface: true,
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
      tokenUsage: graphResult.tokenUsage,
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
  originChannelId: string;
  responseChannelId: string;
  guildId: string | null;
  invokerAuthority: DiscordAuthorityTier;
  isAdmin: boolean;
  canModerate?: boolean;
  onResponseSessionUpdate?: RunChatTurnParams['onResponseSessionUpdate'];
}): Promise<RunChatTurnResult> {
  const runtimeRoute = await resolveTextProviderRoute(params.guildId, 'main');
  if (!runtimeRoute.apiKey) {
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

  const model = runtimeRoute.model;
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
    return {
      runId: params.threadId,
      status: 'failed',
      replyText,
      delivery: 'response_session',
      files: [],
    };
  }

  const activeToolNames = resolveActiveToolNames({
    authority: params.invokerAuthority,
    invokedBy: 'component',
  });
  try {
    const pendingUserInterrupt = toContinuePendingUserInterrupt(taskRun);
    const graphResult = await continueAgentGraphTurn({
      threadId: params.threadId,
      runId: params.traceId,
      runName: 'sage_agent_background_resume',
      context: {
        traceId: params.traceId,
        threadId: params.threadId,
        userId: params.userId,
        channelId: params.responseChannelId,
        originChannelId: params.originChannelId,
        responseChannelId: params.responseChannelId,
        guildId: params.guildId,
        providerId: runtimeRoute.providerId,
        baseUrl: runtimeRoute.baseUrl,
        apiKey: runtimeRoute.apiKey,
        apiKeySource: runtimeRoute.authSource,
        fallbackRoute: runtimeRoute.fallbackRoute,
        model,
        temperature: 0.6,
        timeoutMs: appConfig.TIMEOUT_CHAT_MS,
        maxTokens: normalizeStrictlyPositiveInt(
          appConfig.AGENT_GRAPH_MAX_OUTPUT_TOKENS as number | undefined,
          1_800,
        ),
        invokedBy: 'component',
        invokerAuthority: params.invokerAuthority,
        invokerIsAdmin: params.isAdmin,
        invokerCanModerate: params.canModerate ?? false,
        activeToolNames,
        routeKind: 'background_resume',
      },
      pendingUserInterrupt,
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

    const persistedTaskState = await persistTaskRunFromGraphResult({
      traceId: params.threadId,
      sourceMessageId: taskRun.sourceMessageId ?? params.threadId,
      guildId: params.guildId,
      originChannelId: params.originChannelId,
      responseChannelId: params.responseChannelId,
      userId: params.userId,
      invokerAuthority: params.invokerAuthority,
      isAdmin: params.isAdmin,
      canModerate: params.canModerate,
      graphConfig,
      graphResult,
      existingTaskRun: taskRun,
      resumeCount: taskRun.resumeCount + 1,
      consumedActiveInterruptRevisionOverride: pendingUserInterrupt?.revision ?? null,
    });

    return {
      runId: params.threadId,
      status: persistedTaskState.persistedStatus,
      replyText: graphResult.replyText,
      delivery: graphResult.deliveryDisposition,
      completionKind: graphResult.completionKind,
      stopReason: graphResult.stopReason,
      waitingState: graphResult.waitingState,
      responseSession: graphResult.responseSession,
      artifactDeliveries: graphResult.artifactDeliveries,
      compactionState: graphResult.compactionState,
      tokenUsage: graphResult.tokenUsage,
      files: graphResult.files,
      meta: await buildRunChatTurnMeta({ pendingInterrupt: toPendingInterruptSummary(graphResult.pendingInterrupt) }),
    };
  } catch (error) {
    const replyText = buildRuntimeFailureReply({
      kind: 'background_resume',
      category: classifyGraphFailure(error),
    });
    await failTaskRunAfterBackgroundResumeError({
      taskRun,
      replyText,
    });
    return {
      runId: params.threadId,
      status: 'failed',
      replyText,
      delivery: 'response_session',
      meta: buildRetryMeta(params.threadId, 'background_resume'),
      files: [],
    };
  }
}

export async function continueMatchedTaskRunWithInput(
  params: ContinueMatchedTaskRunWithInputParams,
): Promise<RunChatTurnResult> {
  const runtimeRoute = await resolveTextProviderRoute(params.guildId, 'main');
  if (!runtimeRoute.apiKey) {
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
  if (taskRun.status !== 'completed' || taskRun.completionKind !== 'final_answer') {
    return {
      runId: params.threadId,
      status: 'failed',
      replyText: 'I couldn’t resume that finished task cleanly, so please ask me again.',
      delivery: 'response_session',
      files: [],
    };
  }

  const model = runtimeRoute.model;
  const graphConfig = buildAgentGraphConfig();
  const activeToolNames = resolveActiveToolNames({
    authority: params.invokerAuthority,
    invokedBy: params.currentTurn.invokedBy,
  });

  try {
    const graphResult = await continueAgentGraphTurn({
      threadId: params.threadId,
      runId: params.traceId,
      runName: 'sage_agent_active_interrupt_race_resume',
      context: {
        traceId: params.traceId,
        threadId: params.threadId,
        userId: params.userId,
        channelId: params.responseChannelId,
        originChannelId: params.originChannelId,
        responseChannelId: params.responseChannelId,
        guildId: params.guildId,
        providerId: runtimeRoute.providerId,
        baseUrl: runtimeRoute.baseUrl,
        apiKey: runtimeRoute.apiKey,
        apiKeySource: runtimeRoute.authSource,
        fallbackRoute: runtimeRoute.fallbackRoute,
        model,
        temperature: 0.6,
        timeoutMs: appConfig.TIMEOUT_CHAT_MS,
        maxTokens: normalizeStrictlyPositiveInt(
          appConfig.AGENT_GRAPH_MAX_OUTPUT_TOKENS as number | undefined,
          1_800,
        ),
        invokedBy: params.currentTurn.invokedBy,
        invokerAuthority: params.invokerAuthority,
        invokerIsAdmin: params.isAdmin,
        invokerCanModerate: params.canModerate ?? false,
        activeToolNames,
        routeKind: 'active_interrupt_race_resume',
        currentTurn: params.currentTurn,
        replyTarget: params.replyTarget ?? null,
        promptMode: params.promptMode,
      },
      appendedMessages: [
        new HumanMessage({
          content: params.userContent ?? params.userText,
        }),
      ],
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

    const persistedTaskState = await persistTaskRunFromGraphResult({
      traceId: params.threadId,
      sourceMessageId: taskRun.sourceMessageId ?? params.currentTurn.messageId,
      guildId: params.guildId,
      originChannelId: params.originChannelId,
      responseChannelId: params.responseChannelId,
      userId: params.userId,
      invokerAuthority: params.invokerAuthority,
      isAdmin: params.isAdmin,
      canModerate: params.canModerate,
      graphConfig,
      graphResult,
      existingTaskRun: taskRun,
      resumeCount: taskRun.resumeCount + 1,
      freshResponseSurface: false,
    });

    return {
      runId: params.threadId,
      status: persistedTaskState.persistedStatus,
      replyText: graphResult.replyText,
      delivery: graphResult.deliveryDisposition,
      completionKind: graphResult.completionKind,
      stopReason: graphResult.stopReason,
      waitingState: graphResult.waitingState,
      responseSession: graphResult.responseSession,
      artifactDeliveries: graphResult.artifactDeliveries,
      compactionState: graphResult.compactionState,
      tokenUsage: graphResult.tokenUsage,
      files: graphResult.files,
      meta: await buildRunChatTurnMeta({
        pendingInterrupt: toPendingInterruptSummary(graphResult.pendingInterrupt),
      }),
    };
  } catch (error) {
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
  const runtimeRoute = await resolveTextProviderRoute(params.guildId, 'main');
  if (!runtimeRoute.apiKey) {
    return buildMissingApiKeyResult(params.guildId);
  }

  const model = runtimeRoute.model;
  const activeToolNames = resolveActiveToolNames({
    authority: params.invokerAuthority,
    invokedBy: 'component',
  });
  const routeKind = params.retryKind === 'background_resume' ? 'background_retry' : 'turn_retry';

  if (appConfig.SAGE_TRACE_DB_ENABLED) {
    try {
      await upsertTraceStart({
        id: params.traceId,
        guildId: params.guildId,
        channelId: params.responseChannelId,
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
    const graphConfig = buildAgentGraphConfig();
    const existingTaskRun = await getAgentTaskRunByThreadId(params.threadId);
    const graphResult = await retryAgentGraphTurn({
      threadId: params.threadId,
      runId: params.traceId,
      runName: params.retryKind === 'background_resume' ? 'sage_agent_background_retry' : 'sage_agent_turn_retry',
      context: {
        traceId: params.traceId,
        threadId: params.threadId,
        userId: params.userId,
        channelId: params.responseChannelId,
        originChannelId: params.originChannelId,
        responseChannelId: params.responseChannelId,
        guildId: params.guildId,
        providerId: runtimeRoute.providerId,
        baseUrl: runtimeRoute.baseUrl,
        apiKey: runtimeRoute.apiKey,
        apiKeySource: runtimeRoute.authSource,
        fallbackRoute: runtimeRoute.fallbackRoute,
        model,
        temperature: 0.6,
        timeoutMs: appConfig.TIMEOUT_CHAT_MS,
        maxTokens: normalizeStrictlyPositiveInt(
          appConfig.AGENT_GRAPH_MAX_OUTPUT_TOKENS as number | undefined,
          1_800,
        ),
        invokedBy: 'component',
        invokerAuthority: params.invokerAuthority,
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
      tokenUsage: graphResult.tokenUsage,
    };

    await persistTaskRunFromGraphResult({
      traceId: params.threadId,
      sourceMessageId: existingTaskRun?.sourceMessageId ?? null,
      guildId: params.guildId,
      originChannelId: params.originChannelId,
      responseChannelId: params.responseChannelId,
      userId: params.userId,
      invokerAuthority: params.invokerAuthority,
      isAdmin: params.isAdmin,
      canModerate: params.canModerate,
      graphConfig,
      graphResult,
      existingTaskRun,
      resumeCount: existingTaskRun?.resumeCount ?? 0,
    }).catch((error) => {
      logger.warn(
        { error, traceId: params.traceId, threadId: params.threadId },
        'Failed to persist agent task run state after retry',
      );
    });

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
            plainTextOutcomeSource: graphResult.plainTextOutcomeSource,
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
            plainTextOutcomeSource: graphResult.plainTextOutcomeSource,
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
