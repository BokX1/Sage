import { config as appConfig } from '../../platform/config/env';
import { getApprovalReviewRequestById } from '../admin/approvalReviewRequestRepo';
import {
  buildMissingHostApiKeyText,
  buildMissingSelfHostedGuildApiKeyText,
} from '../discord/userFacingCopy';
import { getRecentMessages } from '../awareness/channelRingBuffer';
import { buildTranscriptBlock } from '../awareness/transcriptBuilder';
import { type BaseMessage } from '@langchain/core/messages';
import { LLMMessageContent } from '../../platform/llm/llm-types';
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
import { resumeAgentGraphTurn, runAgentGraphTurn } from './langgraph/runtime';
import { scrubFinalReplyText } from './finalReplyScrubber';
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

function buildDeterministicToolSummary(toolResults: ToolResult[]): string {
  const successful = toolResults
    .filter((result) => result.success)
    .map((result) => result.name);
  const failed = toolResults
    .filter((result) => !result.success)
    .map((result) => `${result.name}${result.error ? ` (${result.error})` : ''}`);
  const parts: string[] = [];

  if (successful.length > 0) {
    parts.push(`Completed so far: ${successful.join(', ')}.`);
  }
  if (failed.length > 0) {
    parts.push(`Problems encountered: ${failed.join('; ')}.`);
  }

  return parts.join('\n\n').trim();
}

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
  delivery: 'chat_reply' | 'approval_governance_only' | 'chat_reply_with_continue';
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

async function resolveApiKeyForChatTurn(guildId: string | null): Promise<string | undefined> {
  const guildApiKey = guildId ? await getGuildApiKey(guildId) : undefined;
  const apiKey = (guildApiKey ?? appConfig.AI_PROVIDER_API_KEY)?.trim();
  return apiKey || undefined;
}

function buildMissingApiKeyResult(guildId: string | null): RunChatTurnResult {
  return {
    replyText: guildId
      ? buildMissingSelfHostedGuildApiKeyText()
      : buildMissingHostApiKeyText(),
    delivery: 'chat_reply',
    meta: guildId
      ? {
          kind: 'missing_api_key',
          missingApiKey: {
            recovery: 'host_api_key',
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

  const apiKey = await resolveApiKeyForChatTurn(guildId);
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
    maxCallsPerRound: graphConfig.maxToolCallsPerStep,
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
    });
    finalReplyText = graphResult.replyText;
    files = graphResult.files;
    toolResults = graphResult.toolResults;
    pendingInterrupt =
      graphResult.pendingInterrupt?.kind === 'approval_review'
        ? {
            kind: 'approval_review',
            requestId: graphResult.pendingInterrupt.requestId,
          }
        : graphResult.pendingInterrupt?.kind === 'continue_prompt'
          ? {
              kind: 'continue_prompt',
              continuationId: graphResult.pendingInterrupt.continuationId,
              expiresAtIso: graphResult.pendingInterrupt.expiresAtIso,
              completedWindows: graphResult.pendingInterrupt.completedWindows,
              maxWindows: graphResult.pendingInterrupt.maxWindows,
              summaryText: graphResult.pendingInterrupt.summaryText,
            }
          : null;
    delivery = resolveDelivery({ pendingInterrupt });
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
      terminationReason: graphResult.terminationReason,
      toolResultCount: graphResult.toolResults.length,
      successfulToolCount,
      deduplicatedCallCount: graphResult.deduplicatedCallCount,
      truncatedCallCount: graphResult.truncatedCallCount,
      guardrailBlockedCallCount: graphResult.guardrailBlockedCallCount,
      roundEvents: graphResult.roundEvents,
      finalization: graphResult.finalization,
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
  const fallbackToolSummary = buildDeterministicToolSummary(toolResults);
  const safeFinalReplyText =
    cleanedReplyText ||
    fallbackToolSummary ||
    (pendingInterrupt?.kind === 'approval_review'
      ? ''
      : 'I completed part of the request but could not format a final response. Please ask me to try once more.');
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
        terminationReason: (graphBudgetJson?.terminationReason as string | undefined) ?? null,
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
      replyText: 'That continuation is no longer available. Start a fresh request if you want me to keep going.',
    };
  }
  if (session.requestedByUserId !== params.userId || session.channelId !== params.channelId) {
    return {
      ok: false,
      replyText: 'That continuation belongs to a different user or channel, so I cannot resume it here.',
    };
  }
  if (session.status !== 'pending') {
    return {
      ok: false,
      replyText: 'That continuation was already used. Start a fresh request if you want me to keep going.',
    };
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    await markGraphContinuationSessionExpired(session.id).catch(() => undefined);
    return {
      ok: false,
      replyText: 'That continuation expired. Start a fresh request if you want me to keep going.',
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
  const apiKey = await resolveApiKeyForChatTurn(params.guildId);
  if (!apiKey) {
    return buildMissingApiKeyResult(params.guildId);
  }
  const model = appConfig.AI_PROVIDER_MAIN_AGENT_MODEL.trim();
  const activeToolNames = resolveActiveToolNames({
    isAdmin: params.isAdmin,
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
        activeToolNames,
        routeKind: 'continue_resume',
      },
    });
    const pendingInterrupt =
      graphResult.pendingInterrupt?.kind === 'continue_prompt'
        ? {
            kind: 'continue_prompt' as const,
            continuationId: graphResult.pendingInterrupt.continuationId,
            expiresAtIso: graphResult.pendingInterrupt.expiresAtIso,
            completedWindows: graphResult.pendingInterrupt.completedWindows,
            maxWindows: graphResult.pendingInterrupt.maxWindows,
            summaryText: graphResult.pendingInterrupt.summaryText,
          }
        : graphResult.pendingInterrupt?.kind === 'approval_review'
          ? {
              kind: 'approval_review' as const,
              requestId: graphResult.pendingInterrupt.requestId,
            }
          : null;

    const cleanedReplyText = scrubFinalReplyText({
      replyText: graphResult.replyText,
    });
    const fallbackToolSummary = buildDeterministicToolSummary(graphResult.toolResults);
    const safeReplyText =
      cleanedReplyText ||
      fallbackToolSummary ||
      (pendingInterrupt?.kind === 'approval_review'
        ? ''
        : 'I completed part of the request but could not format a final response. Please ask me to continue again.');
    result = {
      replyText: safeReplyText,
      delivery: resolveDelivery({ pendingInterrupt }),
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
            terminationReason: graphResult.terminationReason,
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
            terminationReason: graphResult.terminationReason,
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
        terminationReason: graphResult.terminationReason,
        langSmithRunId: graphResult.langSmithRunId,
        langSmithTraceId: graphResult.langSmithTraceId,
        replyText: safeReplyText,
      });
    }
  } catch (error) {
    logger.error({ error, traceId: params.traceId }, 'Continuation resume failed');
    result = {
      replyText: "I'm having trouble continuing that request right now. Please try again.",
      delivery: 'chat_reply',
      meta: undefined,
      files: [],
    };
    if (appConfig.SAGE_TRACE_DB_ENABLED) {
      await updateTraceEnd({
        id: params.traceId,
        threadId: session.threadId,
        parentTraceId: session.latestTraceId,
        graphStatus: 'failed',
        approvalRequestId: null,
        terminationReason: 'continue_prompt',
        replyText: result.replyText,
        budgetJson: {
          route: 'continue_resume',
          failed: true,
          continuationId: session.id,
          errorText: error instanceof Error ? error.message : String(error),
        },
      }).catch(() => undefined);
    }
  }

  return result;
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

function resolveDelivery(params: {
  pendingInterrupt:
    | { kind: 'approval_review' }
    | {
        kind: 'continue_prompt';
        continuationId: string;
        expiresAtIso: string;
        completedWindows: number;
        maxWindows: number;
        summaryText: string;
      }
    | null;
}): RunChatTurnResult['delivery'] {
  if (!params.pendingInterrupt) return 'chat_reply';
  if (params.pendingInterrupt.kind === 'approval_review') return 'approval_governance_only';
  return 'chat_reply_with_continue';
}
