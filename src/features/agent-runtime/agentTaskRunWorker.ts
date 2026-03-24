import { randomUUID } from 'node:crypto';
import { Message } from 'discord.js';
import { config as appConfig } from '../../platform/config/env';
import { client } from '../../platform/discord/client';
import { logger } from '../../platform/logging/logger';
import { buildAgentGraphConfig } from './langgraph/config';
import type { RunChatTurnParams, RunChatTurnResult } from './agentRuntime';
import type { AgentTaskRunRecord } from './agentTaskRunRepo';
import {
  reconcileResponseSessionChunks,
  type ResponseSessionChannel,
  type ResponseSessionEditableMessage,
  type ResponseSessionReplyAnchor,
} from '../discord/responseSessionChunkDelivery';

type EditableDiscordMessage = ResponseSessionEditableMessage & Pick<Message, 'reply'>;
type SendableChannel = {
  isTextBased?: () => boolean;
  send?: (payload: unknown) => Promise<Message>;
  messages?: {
    fetch: (messageId: string) => Promise<Message>;
  };
};
type WorkerResponseSessionState = {
  sourceMessageId: string | null;
  responseMessageId: string | null;
  overflowMessageIds: string[];
  editableMessage: EditableDiscordMessage | null;
  overflowMessages: ResponseSessionEditableMessage[];
};

function shouldFailOpenMissingCanonicalResponseSurface(
  status: Pick<RunChatTurnResult, 'status'>['status'],
): boolean {
  return status !== 'running';
}

function clearWorkerCanonicalResponseSurface(state: WorkerResponseSessionState): void {
  state.responseMessageId = null;
  state.editableMessage = null;
  state.overflowMessageIds = [];
  state.overflowMessages = [];
}

function readPersistedResponseSessionRefs(value: unknown): {
  sourceMessageId: string | null;
  responseMessageId: string | null;
  surfaceAttached: boolean;
  overflowMessageIds: string[];
} {
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

let workerTimer: NodeJS.Timeout | null = null;
let workerTickInFlight = false;

async function getTaskRunRepo() {
  return import('./agentTaskRunRepo');
}

async function getAgentRuntimeModule() {
  return import('./agentRuntime');
}

function readScheduledBootstrapState(value: unknown): {
  prompt: string;
  mentionedUserIds: string[];
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.trigger !== 'scheduled_agent_run' || typeof record.bootstrapPrompt !== 'string') {
    return null;
  }
  return {
    prompt: record.bootstrapPrompt,
    mentionedUserIds: Array.isArray(record.bootstrapMentionedUserIds)
      ? record.bootstrapMentionedUserIds.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

function resolveWorkerLeaseOwner(): string {
  return `sage-task-worker:${process.pid}:${randomUUID()}`;
}

async function fetchEditableResponseMessage(
  run: AgentTaskRunRecord,
  state: WorkerResponseSessionState,
): Promise<EditableDiscordMessage | null> {
  if (state.editableMessage) {
    return state.editableMessage;
  }

  const channel = (await client.channels.fetch(run.responseChannelId).catch(() => null)) as SendableChannel | null;
  if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
    return null;
  }

  if (state.responseMessageId && channel.messages?.fetch) {
    const responseMessage = await channel.messages.fetch(state.responseMessageId).catch(() => null);
    if (responseMessage) {
      state.editableMessage = responseMessage;
      return responseMessage;
    }
  }

  return null;
}

async function fetchWorkerSendableChannel(channelId: string): Promise<SendableChannel | null> {
  const fetched = (await client.channels.fetch(channelId).catch(() => null)) as SendableChannel | null;
  if (!fetched || typeof fetched.isTextBased !== 'function' || !fetched.isTextBased()) {
    return null;
  }
  return fetched;
}

async function resolveWorkerPublishSurface(params: {
  run: AgentTaskRunRecord;
  state: WorkerResponseSessionState;
}): Promise<{
  channel: SendableChannel | null;
  responseChannelId: string;
  fellBackToOriginChannel: boolean;
}> {
  const currentChannel = await fetchWorkerSendableChannel(params.run.responseChannelId);
  if (currentChannel) {
    return {
      channel: currentChannel,
      responseChannelId: params.run.responseChannelId,
      fellBackToOriginChannel: false,
    };
  }

  if (params.run.responseChannelId !== params.run.originChannelId) {
    const fallbackChannel = await fetchWorkerSendableChannel(params.run.originChannelId);
    if (fallbackChannel) {
      logger.warn(
        {
          threadId: params.run.threadId,
          originChannelId: params.run.originChannelId,
          responseChannelId: params.run.responseChannelId,
        },
        'Worker response surface is unavailable; falling back to the origin channel',
      );
      params.run.responseChannelId = params.run.originChannelId;
      clearWorkerCanonicalResponseSurface(params.state);
      return {
        channel: fallbackChannel,
        responseChannelId: params.run.originChannelId,
        fellBackToOriginChannel: true,
      };
    }
  }

  return {
    channel: null,
    responseChannelId: params.run.responseChannelId,
    fellBackToOriginChannel: false,
  };
}

async function refreshWorkerResponseSessionState(
  run: AgentTaskRunRecord,
  state: WorkerResponseSessionState,
): Promise<{
  status: 'refreshed' | 'missing' | 'failed';
  expectedCanonicalResponseSurface: boolean;
}> {
  const { getAgentTaskRunByThreadId } = await getTaskRunRepo();
  const latestRun = await getAgentTaskRunByThreadId(run.threadId).catch((error) => {
    logger.warn(
      { error, threadId: run.threadId, taskRunId: run.id },
      'Failed to refresh worker response-session state before publishing',
    );
    return undefined;
  });
  if (latestRun === undefined) {
    return {
      status: 'failed',
      expectedCanonicalResponseSurface: false,
    };
  }
  if (!latestRun) {
    return {
      status: 'missing',
      expectedCanonicalResponseSurface: false,
    };
  }

  const latestPersistedRefs = readPersistedResponseSessionRefs(latestRun.responseSessionJson);
  const nextSourceMessageId = latestRun.sourceMessageId ?? latestPersistedRefs.sourceMessageId;
  const nextResponseMessageId = latestRun.responseMessageId ?? latestPersistedRefs.responseMessageId;
  const nextOverflowMessageIds =
    latestPersistedRefs.overflowMessageIds.length > 0
      ? latestPersistedRefs.overflowMessageIds
      : state.overflowMessageIds;

  if (nextSourceMessageId) {
    state.sourceMessageId = nextSourceMessageId;
  }
  if (nextResponseMessageId && nextResponseMessageId !== state.responseMessageId) {
    state.responseMessageId = nextResponseMessageId;
    state.editableMessage = null;
  }
  if (nextOverflowMessageIds !== state.overflowMessageIds) {
    state.overflowMessageIds = [...nextOverflowMessageIds];
    state.overflowMessages = [];
  }
  return {
    status: 'refreshed',
    expectedCanonicalResponseSurface:
      latestPersistedRefs.surfaceAttached || typeof nextResponseMessageId === 'string',
  };
}

async function publishTaskRunResult(params: {
  run: AgentTaskRunRecord;
  result: Pick<RunChatTurnResult, 'replyText' | 'responseSession' | 'status'>;
  update?: Parameters<NonNullable<RunChatTurnParams['onResponseSessionUpdate']>>[0];
  state: WorkerResponseSessionState;
}): Promise<void> {
  const publishSurface = await resolveWorkerPublishSurface(params);
  const channel = publishSurface.channel;
  if (!channel) {
    return;
  }

  const nextText = (
    params.update?.responseSession.latestText ||
    params.update?.replyText ||
    params.result.replyText ||
    ''
  ).trim();
  if (!nextText) {
    return;
  }

  let existing = await fetchEditableResponseMessage(params.run, params.state);
  let refreshStatus: 'refreshed' | 'missing' | 'failed' = 'refreshed';
  let expectedCanonicalResponseSurface = !!params.state.responseMessageId;
  if (!existing && !publishSurface.fellBackToOriginChannel) {
    const refreshResult = await refreshWorkerResponseSessionState(params.run, params.state);
    refreshStatus = refreshResult.status;
    expectedCanonicalResponseSurface = refreshResult.expectedCanonicalResponseSurface;
    existing = await fetchEditableResponseMessage(params.run, params.state);
  }
  if (!existing && refreshStatus !== 'refreshed') {
    logger.warn(
      {
        threadId: params.run.threadId,
        originChannelId: params.run.originChannelId,
        responseChannelId: params.run.responseChannelId,
        refreshStatus,
      },
      'Skipping worker response publish because the canonical response surface could not be revalidated',
    );
    return;
  }
  if (
    !existing &&
    !publishSurface.fellBackToOriginChannel &&
    shouldFailOpenMissingCanonicalResponseSurface(params.result.status) &&
    (expectedCanonicalResponseSurface || !!params.state.responseMessageId)
  ) {
    logger.warn(
      {
        threadId: params.run.threadId,
        originChannelId: params.run.originChannelId,
        responseChannelId: params.run.responseChannelId,
        responseMessageId: params.state.responseMessageId,
        status: params.result.status,
      },
      'Worker canonical response message is unavailable during terminal publish; clearing stale response-session refs and failing open to a fresh reply',
    );
    clearWorkerCanonicalResponseSurface(params.state);
    expectedCanonicalResponseSurface = false;
  }
  if (!existing && expectedCanonicalResponseSurface) {
    logger.warn(
      {
        threadId: params.run.threadId,
        originChannelId: params.run.originChannelId,
        responseChannelId: params.run.responseChannelId,
        responseMessageId: params.state.responseMessageId,
      },
      'Skipping worker response publish because a canonical response surface should already exist but is not attached',
    );
    return;
  }
  if (!existing && params.state.responseMessageId) {
    logger.warn(
      {
        threadId: params.run.threadId,
        originChannelId: params.run.originChannelId,
        responseChannelId: params.run.responseChannelId,
        responseMessageId: params.state.responseMessageId,
      },
      'Skipping worker response publish because the canonical response message could not be fetched',
    );
    return;
  }
  const sourceMessage =
    !existing && params.state.sourceMessageId && channel.messages?.fetch
      ? await channel.messages.fetch(params.state.sourceMessageId).catch(() => null)
      : null;
  const reconciled = await reconcileResponseSessionChunks({
    channel: channel as unknown as ResponseSessionChannel,
    nextText,
    state: {
      primaryMessage: existing,
      replyAnchor:
        !existing && sourceMessage && 'reply' in sourceMessage
          ? (sourceMessage as ResponseSessionReplyAnchor)
          : null,
      overflowMessageIds: params.state.overflowMessageIds,
      overflowMessages: params.state.overflowMessages,
    },
    allowedMentions: { repliedUser: false },
  });
  const responseMessageId = reconciled.primaryMessage.id;
  params.state.responseMessageId = responseMessageId;
  params.state.editableMessage = reconciled.primaryMessage as EditableDiscordMessage;
  params.state.overflowMessageIds = reconciled.overflowMessageIds;
  params.state.overflowMessages = reconciled.overflowMessages;

  if (responseMessageId) {
    const { attachTaskRunResponseSession } = await getAgentRuntimeModule();
    await attachTaskRunResponseSession({
      threadId: params.run.threadId,
      requestedByUserId: params.run.requestedByUserId,
      originChannelId: params.run.originChannelId,
      responseChannelId: publishSurface.responseChannelId,
      guildId: params.run.guildId,
      sourceMessageId: params.state.sourceMessageId,
      responseMessageId,
      responseSession: params.result.responseSession
        ? {
            ...params.result.responseSession,
            responseMessageId,
            overflowMessageIds: reconciled.overflowMessageIds,
          }
        : params.update?.responseSession
          ? {
              ...params.update.responseSession,
              responseMessageId,
              overflowMessageIds: reconciled.overflowMessageIds,
            }
          : undefined,
    }).catch((error) => {
      logger.warn({ error, threadId: params.run.threadId }, 'Failed to persist worker response session attachment');
    });
  }
}

async function processRunnableTaskRun(run: AgentTaskRunRecord): Promise<void> {
  const { claimRunnableAgentTaskRun, heartbeatAgentTaskRun, releaseAgentTaskRunLease } =
    await getTaskRunRepo();
  const { resumeBackgroundTaskRun, runChatTurn } = await getAgentRuntimeModule();
  const leaseOwner = resolveWorkerLeaseOwner();
  const graphConfig = buildAgentGraphConfig();
  const leaseExpiresAt = new Date(Date.now() + graphConfig.leaseTtlMs);
  const claimed = await claimRunnableAgentTaskRun({
    id: run.id,
    leaseOwner,
    leaseExpiresAt,
  });
  if (!claimed) {
    return;
  }

  await heartbeatAgentTaskRun({
    id: run.id,
    leaseOwner,
    leaseExpiresAt,
  }).catch(() => undefined);

  const checkpointMetadata = (run.checkpointMetadataJson ?? {}) as {
    invokerAuthority?: 'member' | 'moderator' | 'admin' | 'owner';
    isAdmin?: boolean;
    canModerate?: boolean;
  };
  const scheduledBootstrap = readScheduledBootstrapState(run.checkpointMetadataJson);
  const persistedResponseRefs = readPersistedResponseSessionRefs(run.responseSessionJson);
  const responseSessionState: WorkerResponseSessionState = {
    sourceMessageId: run.sourceMessageId ?? persistedResponseRefs.sourceMessageId,
    responseMessageId: run.responseMessageId ?? persistedResponseRefs.responseMessageId,
    overflowMessageIds: [...persistedResponseRefs.overflowMessageIds],
    editableMessage: null,
    overflowMessages: [],
  };

  const heartbeatTimer = setInterval(() => {
    const nextLeaseExpiresAt = new Date(Date.now() + graphConfig.leaseTtlMs);
    void heartbeatAgentTaskRun({
      id: run.id,
      leaseOwner,
      leaseExpiresAt: nextLeaseExpiresAt,
    }).catch((error) => {
      logger.warn(
        { error, taskRunId: run.id, threadId: run.threadId },
        'Agent task run worker failed to extend task lease heartbeat',
      );
    });
  }, graphConfig.heartbeatMs);
  heartbeatTimer.unref();

  try {
    const invokerAuthority =
      checkpointMetadata.invokerAuthority ??
      (checkpointMetadata.isAdmin ? 'admin' : checkpointMetadata.canModerate ? 'moderator' : 'member');
    const result = scheduledBootstrap
      ? await (async () => {
        const { getUserProfileRecord } = await import('../memory/userProfileRepo');
        const userProfileSummary = (await getUserProfileRecord(run.requestedByUserId).catch(() => null))?.summary ?? null;
        return runChatTurn({
          traceId: run.threadId,
          userId: run.requestedByUserId,
          originChannelId: run.originChannelId,
          responseChannelId: run.responseChannelId,
          guildId: run.guildId,
          messageId: run.threadId,
          userText: scheduledBootstrap.prompt,
          userProfileSummary,
          currentTurn: {
            invokerUserId: run.requestedByUserId,
            invokerDisplayName: 'Scheduler',
            messageId: run.threadId,
            guildId: run.guildId,
            originChannelId: run.originChannelId,
            responseChannelId: run.responseChannelId,
            invokedBy: 'component',
            mentionedUserIds: scheduledBootstrap.mentionedUserIds,
            isDirectReply: false,
            replyTargetMessageId: null,
            replyTargetAuthorId: null,
            botUserId: client.user?.id ?? null,
          },
          mentionedUserIds: scheduledBootstrap.mentionedUserIds,
          invokedBy: 'component',
          invokerAuthority,
          isAdmin: checkpointMetadata.isAdmin ?? false,
          canModerate: checkpointMetadata.canModerate ?? false,
          onResponseSessionUpdate: async (update) => {
            await publishTaskRunResult({
              run,
              result: {
                replyText: update.replyText,
                responseSession: update.responseSession,
                status:
                  update.completionKind === 'approval_pending'
                    ? 'waiting_approval'
                    : update.completionKind === 'user_input_pending'
                      ? 'waiting_user_input'
                      : update.stopReason === 'background_yield'
                        ? 'running'
                        : 'completed',
              },
              update,
              state: responseSessionState,
            });
          },
        });
      })()
      : await resumeBackgroundTaskRun({
        traceId: randomUUID(),
        threadId: run.threadId,
        leaseOwner,
        userId: run.requestedByUserId,
        originChannelId: run.originChannelId,
        responseChannelId: run.responseChannelId,
        guildId: run.guildId,
        invokerAuthority,
        isAdmin: checkpointMetadata.isAdmin ?? false,
        canModerate: checkpointMetadata.canModerate ?? false,
        onResponseSessionUpdate: async (update) => {
          await publishTaskRunResult({
            run,
            result: {
              replyText: update.replyText,
              responseSession: update.responseSession,
              status:
                update.completionKind === 'approval_pending'
                  ? 'waiting_approval'
                  : update.completionKind === 'user_input_pending'
                    ? 'waiting_user_input'
                    : update.stopReason === 'background_yield'
                      ? 'running'
                      : 'completed',
            },
            update,
            state: responseSessionState,
          });
        },
      });

    const { getAgentTaskRunByThreadId } = await getTaskRunRepo();
    const latestTaskRun = await getAgentTaskRunByThreadId(run.threadId).catch(() => null);
    const shouldSuppressTerminalPublish =
      result.completionKind === 'final_answer' && latestTaskRun?.status === 'running';
    if (shouldSuppressTerminalPublish) {
      logger.info(
        { threadId: run.threadId, taskRunId: run.id },
        'Skipping terminal worker publish because a newer active-run interrupt kept the task runnable',
      );
      return;
    }

    await publishTaskRunResult({
      run,
      result,
      state: responseSessionState,
    });
  } finally {
    clearInterval(heartbeatTimer);
    await releaseAgentTaskRunLease({
      id: run.id,
      leaseOwner,
    }).catch(() => undefined);
  }
}

async function tickAgentTaskRunWorker(): Promise<void> {
  if (workerTickInFlight || !client.isReady()) {
    return;
  }
  workerTickInFlight = true;
  try {
    const { listRunnableAgentTaskRuns } = await getTaskRunRepo();
    const runs = await listRunnableAgentTaskRuns({
      limit: 3,
    });
    for (const run of runs) {
      await processRunnableTaskRun(run).catch((error) => {
        logger.error({ error, threadId: run.threadId, taskRunId: run.id }, 'Agent task run worker failed to process run');
      });
    }
  } finally {
    workerTickInFlight = false;
  }
}

export function initAgentTaskRunWorker(): void {
  if (workerTimer || process.env.VITEST_WORKER_ID !== undefined) {
    return;
  }

  workerTimer = setInterval(() => {
    void tickAgentTaskRunWorker();
  }, appConfig.AGENT_RUN_WORKER_POLL_MS);
  workerTimer.unref();
}

export function stopAgentTaskRunWorker(): void {
  if (!workerTimer) {
    return;
  }
  clearInterval(workerTimer);
  workerTimer = null;
}

export function __resetAgentTaskRunWorkerForTests(): void {
  stopAgentTaskRunWorker();
  workerTickInFlight = false;
}
