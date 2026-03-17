import { randomUUID } from 'node:crypto';
import { Message } from 'discord.js';
import { config as appConfig } from '../../platform/config/env';
import { client } from '../../platform/discord/client';
import { logger } from '../../platform/logging/logger';
import { smartSplit } from '../../shared/text/message-splitter';
import { buildAgentGraphConfig } from './langgraph/config';
import type { RunChatTurnParams, RunChatTurnResult } from './agentRuntime';
import type { AgentTaskRunRecord } from './agentTaskRunRepo';

type EditableDiscordMessage = Pick<Message, 'id' | 'edit' | 'reply'>;
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
  editableMessage: EditableDiscordMessage | null;
};

function readPersistedResponseSessionRefs(value: unknown): {
  sourceMessageId: string | null;
  responseMessageId: string | null;
} {
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

let workerTimer: NodeJS.Timeout | null = null;
let workerTickInFlight = false;

async function getTaskRunRepo() {
  return import('./agentTaskRunRepo');
}

async function getAgentRuntimeModule() {
  return import('./agentRuntime');
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

  const channel = (await client.channels.fetch(run.channelId).catch(() => null)) as SendableChannel | null;
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

  if (state.sourceMessageId && channel.messages?.fetch) {
    const sourceMessage = await channel.messages.fetch(state.sourceMessageId).catch(() => null);
    if (sourceMessage) {
      return sourceMessage;
    }
  }

  return null;
}

async function publishTaskRunResult(params: {
  run: AgentTaskRunRecord;
  result: Pick<RunChatTurnResult, 'replyText' | 'responseSession' | 'status'>;
  update?: Parameters<NonNullable<RunChatTurnParams['onResponseSessionUpdate']>>[0];
  state: WorkerResponseSessionState;
}): Promise<void> {
  const channel = (await client.channels.fetch(params.run.channelId).catch(() => null)) as SendableChannel | null;
  if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
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

  const [primaryChunk, ...restChunks] = smartSplit(nextText, 2_000);
  const primaryText = primaryChunk || nextText;
  const existing = await fetchEditableResponseMessage(params.run, params.state);

  let responseMessageId =
    params.state.responseMessageId ??
    params.run.responseMessageId ??
    params.update?.responseSession.responseMessageId ??
    null;
  if (existing && 'edit' in existing) {
    if (
      'reply' in existing &&
      responseMessageId === null &&
      params.state.sourceMessageId === existing.id
    ) {
      const reply = await existing.reply({
        content: primaryText,
        allowedMentions: { repliedUser: false },
      });
      responseMessageId = reply.id;
      params.state.responseMessageId = reply.id;
      params.state.editableMessage = reply;
    } else {
      await existing.edit({
        content: primaryText,
        allowedMentions: { repliedUser: false },
      });
      responseMessageId = existing.id;
      params.state.responseMessageId = existing.id;
      params.state.editableMessage = existing;
    }
  } else if (typeof channel.send === 'function') {
    const sent = await channel.send({
      content: primaryText,
      allowedMentions: { repliedUser: false },
    });
    responseMessageId = sent.id;
    params.state.responseMessageId = sent.id;
    params.state.editableMessage = sent;
  }

  if (responseMessageId) {
    const { attachTaskRunResponseSession } = await getAgentRuntimeModule();
    await attachTaskRunResponseSession({
      threadId: params.run.threadId,
      sourceMessageId: params.state.sourceMessageId,
      responseMessageId,
      responseSession: params.result.responseSession
        ? {
            ...params.result.responseSession,
            responseMessageId,
          }
        : params.update?.responseSession
          ? {
              ...params.update.responseSession,
              responseMessageId,
            }
          : undefined,
    }).catch((error) => {
      logger.warn({ error, threadId: params.run.threadId }, 'Failed to persist worker response session attachment');
    });
  }

  const isTerminal =
    params.result.status === 'completed' ||
    params.result.status === 'failed' ||
    params.result.status === 'cancelled' ||
    params.result.status === 'waiting_approval' ||
    params.result.status === 'waiting_user_input';
  if (isTerminal && restChunks.length > 0 && typeof channel.send === 'function') {
    for (const chunk of restChunks) {
      await channel.send({
        content: chunk,
        allowedMentions: { repliedUser: false },
      });
    }
  }
}

async function processRunnableTaskRun(run: AgentTaskRunRecord): Promise<void> {
  const { claimRunnableAgentTaskRun, heartbeatAgentTaskRun, releaseAgentTaskRunLease } =
    await getTaskRunRepo();
  const { resumeBackgroundTaskRun } = await getAgentRuntimeModule();
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
    isAdmin?: boolean;
    canModerate?: boolean;
  };
  const persistedResponseRefs = readPersistedResponseSessionRefs(run.responseSessionJson);
  const responseSessionState: WorkerResponseSessionState = {
    sourceMessageId: run.sourceMessageId ?? persistedResponseRefs.sourceMessageId,
    responseMessageId: run.responseMessageId ?? persistedResponseRefs.responseMessageId,
    editableMessage: null,
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
    const result = await resumeBackgroundTaskRun({
      traceId: randomUUID(),
      threadId: run.threadId,
      leaseOwner,
      userId: run.requestedByUserId,
      channelId: run.channelId,
      guildId: run.guildId,
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
                : update.completionKind === 'clarification_question'
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
