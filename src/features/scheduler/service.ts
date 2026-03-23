import { client } from '../../platform/discord/client';
import { logger } from '../../platform/logging/logger';
import type { CurrentTurnContext } from '../agent-runtime/continuityContext';
import type { GraphResponseSession } from '../agent-runtime/langgraph/types';
import {
  reconcileResponseSessionChunks,
  type ResponseSessionChannel,
  type ResponseSessionEditableMessage,
} from '../discord/responseSessionChunkDelivery';
import { getGuildTimezone, setGuildTimezone } from '../settings/guildSettingsRepo';
import {
  assertValidTimezone,
  buildScheduledTaskDedupeKey,
  computeFirstScheduledRun,
  computeNextRecurringRun,
  sanitizeReminderMentions,
} from './schedule';
import {
  cancelScheduledTask,
  completeScheduledTask,
  completeScheduledTaskRun,
  getScheduledTaskById,
  listScheduledTaskRuns,
  listScheduledTasksByGuild,
  markScheduledTaskRunStart,
  upsertScheduledTask,
} from './scheduledTaskRepo';
import type {
  AgentRunPayload,
  ReminderMessagePayload,
  ScheduledTaskKind,
  ScheduledTaskRecord as ScheduledTaskRecordType,
  ScheduledTaskRunRecord,
  ScheduledTaskRuntimeDiagnostic,
} from './types';

type SendableGuildChannel = {
  id: string;
  guildId?: string;
  isDMBased?: () => boolean;
  isTextBased?: () => boolean;
  send: (payload: { content: string; allowedMentions?: { parse: []; users?: string[]; roles?: string[] } }) => Promise<ResponseSessionEditableMessage>;
  messages?: {
    fetch: (messageId: string) => Promise<ResponseSessionEditableMessage>;
  };
};

const ACTIVE_TASK_LIMIT_PER_GUILD = 50;
let lastSchedulerDiagnosticSnapshot: ScheduledTaskRuntimeDiagnostic | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function fetchTextChannel(channelId: string, expectedGuildId?: string): Promise<SendableGuildChannel> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.isDMBased?.() || !('send' in channel) || typeof channel.send !== 'function') {
    throw new Error('Scheduled task target channel is unavailable or does not support sending messages.');
  }
  if (expectedGuildId && (!('guildId' in channel) || channel.guildId !== expectedGuildId)) {
    throw new Error('Scheduled task target channel must belong to the active guild.');
  }
  if (typeof channel.isTextBased === 'function' && !channel.isTextBased()) {
    throw new Error('Scheduled task target channel is not text-based.');
  }
  return channel as unknown as SendableGuildChannel;
}

function readReminderPayload(value: unknown): ReminderMessagePayload {
  if (!isRecord(value) || typeof value.content !== 'string') {
    throw new Error('Reminder payload is invalid.');
  }
  return {
    kind: 'reminder_message',
    content: value.content,
    roleIds: Array.isArray(value.roleIds)
      ? value.roleIds.filter((entry): entry is string => typeof entry === 'string')
      : [],
    userIds: Array.isArray(value.userIds)
      ? value.userIds.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

function readAgentRunPayload(value: unknown): AgentRunPayload {
  if (!isRecord(value) || typeof value.prompt !== 'string') {
    throw new Error('Scheduled agent-run payload is invalid.');
  }
  return {
    kind: 'agent_run',
    prompt: value.prompt,
    mentionedUserIds: Array.isArray(value.mentionedUserIds)
      ? value.mentionedUserIds.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

async function resolveTaskTimezone(params: {
  guildId: string;
  timezone?: string;
}): Promise<{
  timezone: string;
  persistGuildTimezone: string | null;
}> {
  const explicit = params.timezone?.trim();
  if (explicit) {
    const validated = assertValidTimezone(explicit);
    return {
      timezone: validated,
      persistGuildTimezone: validated,
    };
  }
  const stored = await getGuildTimezone(params.guildId);
  return {
    timezone: stored ? assertValidTimezone(stored) : 'UTC',
    persistGuildTimezone: null,
  };
}

export async function upsertScheduledTaskForTool(params: {
  guildId: string;
  requestedByUserId: string;
  taskId?: string;
  kind: ScheduledTaskKind;
  channelId: string;
  timezone?: string;
  cronExpr?: string | null;
  runAtIso?: string | null;
  payload: ReminderMessagePayload | AgentRunPayload;
}): Promise<Record<string, unknown>> {
  const existingTask = params.taskId ? await getScheduledTaskById(params.taskId) : null;
  if (params.taskId && (!existingTask || existingTask.guildId !== params.guildId)) {
    throw new Error('Scheduled task not found.');
  }

  const existingTasks = await listScheduledTasksByGuild(params.guildId);
  const isCreate = !params.taskId;
  if (isCreate && existingTasks.filter((task) => task.status === 'active').length >= ACTIVE_TASK_LIMIT_PER_GUILD) {
    throw new Error(`This guild already has the maximum of ${ACTIVE_TASK_LIMIT_PER_GUILD} active scheduled tasks.`);
  }

  const timezoneResolution = await resolveTaskTimezone({
    guildId: params.guildId,
    timezone: params.timezone,
  });
  await fetchTextChannel(params.channelId, params.guildId);
  const runAt = params.runAtIso ? new Date(params.runAtIso) : null;
  const nextRunAt = computeFirstScheduledRun({
    timezone: timezoneResolution.timezone,
    cronExpr: params.cronExpr ?? null,
    runAt,
  });

  const task = await upsertScheduledTask({
    id: params.taskId,
    guildId: params.guildId,
    channelId: params.channelId,
    createdByUserId: params.requestedByUserId,
    kind: params.kind,
    status: 'active',
    timezone: timezoneResolution.timezone,
    cronExpr: params.cronExpr ?? null,
    runAt,
    nextRunAt,
    payloadJson: params.payload,
    provenanceJson: {
      source: 'discord_admin_tool',
      requestedByUserId: params.requestedByUserId,
    },
  });

  if (timezoneResolution.persistGuildTimezone) {
    await setGuildTimezone(params.guildId, timezoneResolution.persistGuildTimezone);
  }

  return {
    ok: true,
    action: 'upsert_scheduled_task',
    task: {
      id: task.id,
      kind: task.kind,
      status: task.status,
      timezone: task.timezone,
      cronExpr: task.cronExpr,
      runAt: task.runAt?.toISOString() ?? null,
      nextRunAt: task.nextRunAt?.toISOString() ?? null,
      channelId: task.channelId,
    },
  };
}

export async function cancelScheduledTaskForTool(params: {
  guildId: string;
  taskId: string;
}): Promise<Record<string, unknown>> {
  const task = await getScheduledTaskById(params.taskId);
  if (!task || task.guildId !== params.guildId) {
    throw new Error('Scheduled task not found.');
  }
  const cancelled = await cancelScheduledTask(task.id);
  return {
    ok: true,
    action: 'cancel_scheduled_task',
    taskId: cancelled.id,
    status: cancelled.status,
  };
}

export async function listScheduledTasksForTool(params: {
  guildId: string;
}): Promise<Record<string, unknown>> {
  const tasks = await listScheduledTasksByGuild(params.guildId);
  return {
    ok: true,
    action: 'list_scheduled_tasks',
    guildId: params.guildId,
    items: tasks.map((task) => ({
      id: task.id,
      kind: task.kind,
      status: task.status,
      timezone: task.timezone,
      cronExpr: task.cronExpr,
      runAt: task.runAt?.toISOString() ?? null,
      nextRunAt: task.nextRunAt?.toISOString() ?? null,
      lastRunAt: task.lastRunAt?.toISOString() ?? null,
      lastSuccessAt: task.lastSuccessAt?.toISOString() ?? null,
      channelId: task.channelId,
      lastErrorText: task.lastErrorText,
    })),
  };
}

export async function getScheduledTaskForTool(params: {
  guildId: string;
  taskId: string;
}): Promise<Record<string, unknown>> {
  const task = await getScheduledTaskById(params.taskId);
  if (!task || task.guildId !== params.guildId) {
    throw new Error('Scheduled task not found.');
  }
  const recentRuns = await listScheduledTaskRuns({
    taskId: task.id,
    limit: 10,
  });
  return {
    ok: true,
    action: 'get_scheduled_task',
    guildId: params.guildId,
    task: {
      ...task,
      runAt: task.runAt?.toISOString() ?? null,
      nextRunAt: task.nextRunAt?.toISOString() ?? null,
      lastRunAt: task.lastRunAt?.toISOString() ?? null,
      lastSuccessAt: task.lastSuccessAt?.toISOString() ?? null,
      leaseExpiresAt: task.leaseExpiresAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    },
    recentRuns: recentRuns.map((run) => ({
      ...run,
      scheduledFor: run.scheduledFor.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    })),
  };
}

async function executeReminderTask(task: ScheduledTaskRecordType): Promise<Record<string, unknown>> {
  const payload = readReminderPayload(task.payloadJson);
  const mentions = sanitizeReminderMentions({
    roleIds: payload.roleIds,
    userIds: payload.userIds,
  });
  const channel = await fetchTextChannel(task.channelId, task.guildId);
  const message = await channel.send({
    content: payload.content,
    allowedMentions: {
      parse: [],
      users: mentions.userIds,
      roles: mentions.roleIds,
    },
  });
  return {
    kind: 'reminder_message',
    status: 'sent',
    channelId: task.channelId,
    messageId: message.id,
  };
}

async function executeAgentRunTask(task: ScheduledTaskRecordType, scheduledRun: ScheduledTaskRunRecord): Promise<Record<string, unknown>> {
  const { generateChatReply } = await import('../chat/chat-engine');
  const { attachTaskRunResponseSession } = await import('../agent-runtime/agentRuntime');
  const payload = readAgentRunPayload(task.payloadJson);
  const traceId = `scheduled:${task.id}:${scheduledRun.id}`;
  const channel = await fetchTextChannel(task.channelId, task.guildId);
  let responseMessage: ResponseSessionEditableMessage | null = null;
  let overflowMessages: ResponseSessionEditableMessage[] = [];
  let overflowMessageIds: string[] = [];
  let latestText = '';
  let latestRevision = -1;

  const currentTurn: CurrentTurnContext = {
    invokerUserId: task.createdByUserId,
    invokerDisplayName: 'Scheduler',
    messageId: traceId,
    guildId: task.guildId,
    channelId: task.channelId,
    invokedBy: 'component',
    mentionedUserIds: payload.mentionedUserIds ?? [],
    isDirectReply: false,
    replyTargetMessageId: null,
    replyTargetAuthorId: null,
    botUserId: client.user?.id ?? null,
  };

  const onResponseSessionUpdate = async (update: {
    replyText: string;
    responseSession: GraphResponseSession;
  }) => {
    if (update.responseSession.draftRevision <= latestRevision) {
      return;
    }
    const draft = (update.responseSession.latestText || update.replyText || '').trim();
    if (!draft || draft === latestText) {
      latestRevision = update.responseSession.draftRevision;
      return;
    }

    const reconciled = await reconcileResponseSessionChunks({
      channel: channel as unknown as ResponseSessionChannel,
      nextText: draft,
      state: {
        primaryMessage: responseMessage,
        replyAnchor: null,
        overflowMessageIds,
        overflowMessages,
      },
      allowedMentions: { repliedUser: false },
    });
    responseMessage = reconciled.primaryMessage;
    overflowMessageIds = reconciled.overflowMessageIds;
    overflowMessages = reconciled.overflowMessages;
    latestText = draft;
    latestRevision = update.responseSession.draftRevision;

    await attachTaskRunResponseSession({
      threadId: traceId,
      requestedByUserId: task.createdByUserId,
      channelId: task.channelId,
      guildId: task.guildId,
      sourceMessageId: traceId,
      responseMessageId: responseMessage.id,
      responseSession: {
        ...update.responseSession,
        sourceMessageId: traceId,
        responseMessageId: responseMessage.id,
        overflowMessageIds,
        surfaceAttached: true,
      },
    }).catch((error) => {
      logger.warn({ error, threadId: traceId, taskId: task.id }, 'Failed to persist scheduled agent-run response session');
    });
  };

  const result = await generateChatReply({
    traceId,
    userId: task.createdByUserId,
    channelId: task.channelId,
    guildId: task.guildId,
    messageId: traceId,
    userText: payload.prompt,
    currentTurn,
    mentionedUserIds: payload.mentionedUserIds ?? [],
    invokedBy: 'component',
    isAdmin: false,
    canModerate: false,
    onResponseSessionUpdate: async (update) => {
      await onResponseSessionUpdate({
        replyText: update.replyText,
        responseSession: update.responseSession,
      });
    },
  });

  const finalText = result.replyText.trim();
  if (finalText && finalText !== latestText) {
    const reconciled = await reconcileResponseSessionChunks({
      channel: channel as unknown as ResponseSessionChannel,
      nextText: finalText,
      state: {
        primaryMessage: responseMessage,
        replyAnchor: null,
        overflowMessageIds,
        overflowMessages,
      },
      allowedMentions: { repliedUser: false },
    });
    responseMessage = reconciled.primaryMessage;
    overflowMessageIds = reconciled.overflowMessageIds;
    overflowMessages = reconciled.overflowMessages;
    latestText = finalText;
    await attachTaskRunResponseSession({
      threadId: traceId,
      requestedByUserId: task.createdByUserId,
      channelId: task.channelId,
      guildId: task.guildId,
      sourceMessageId: traceId,
      responseMessageId: responseMessage.id,
      responseSession: result.responseSession
        ? {
            ...result.responseSession,
            sourceMessageId: traceId,
            responseMessageId: responseMessage.id,
            overflowMessageIds,
            surfaceAttached: true,
          }
        : undefined,
    }).catch(() => undefined);
  }

  return {
    kind: 'agent_run',
    status: 'completed',
    delivery: result.delivery,
    responseMessageId: responseMessage?.id ?? null,
    completionKind: result.meta?.kind ?? null,
  };
}

export async function executeScheduledTask(task: ScheduledTaskRecordType): Promise<Record<string, unknown>> {
  const scheduledFor = task.nextRunAt ?? task.runAt;
  if (!scheduledFor) {
    throw new Error('Scheduled task is missing a due time.');
  }
  const dedupeKey = buildScheduledTaskDedupeKey(task.id, scheduledFor);
  const taskRunState = await markScheduledTaskRunStart({
    taskId: task.id,
    dedupeKey,
    scheduledFor,
  });
  const taskRun = taskRunState.run;

  if (!taskRunState.created) {
    return {
      kind: task.kind,
      status: taskRun.status,
      dedupeKey,
    };
  }

  try {
    const result =
      task.kind === 'reminder_message'
        ? await executeReminderTask(task)
        : await executeAgentRunTask(task, taskRun);
    const nextRunAt = task.cronExpr
      ? computeNextRecurringRun({
          cronExpr: task.cronExpr,
          timezone: task.timezone,
          from: scheduledFor,
        })
      : null;
    await completeScheduledTaskRun({
      id: taskRun.id,
      status: 'succeeded',
      resultJson: result,
    });
    await completeScheduledTask({
      id: task.id,
      leaseOwner: task.leaseOwner ?? 'scheduler',
      nextRunAt,
      succeeded: true,
      finishedAt: new Date(),
    });
    return result;
  } catch (error) {
    await completeScheduledTaskRun({
      id: taskRun.id,
      status: 'failed',
      errorText: error instanceof Error ? error.message : String(error),
    });
    await completeScheduledTask({
      id: task.id,
      leaseOwner: task.leaseOwner ?? 'scheduler',
      nextRunAt: task.cronExpr
        ? computeNextRecurringRun({
            cronExpr: task.cronExpr,
            timezone: task.timezone,
            from: scheduledFor,
          })
        : null,
      succeeded: false,
      finishedAt: new Date(),
      lastErrorText: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function getScheduledTaskRuntimeDiagnostics(): Promise<ScheduledTaskRuntimeDiagnostic> {
  const guildIds = client.guilds.cache.map((guild) => guild.id);
  let activeTasks = 0;
  let leasedTasks = 0;
  let dueTasks = 0;
  const now = Date.now();
  for (const guildId of guildIds) {
    const tasks = await listScheduledTasksByGuild(guildId).catch(() => []);
    activeTasks += tasks.filter((task) => task.status === 'active').length;
    leasedTasks += tasks.filter((task) => task.leaseExpiresAt && task.leaseExpiresAt.getTime() > now).length;
    dueTasks += tasks.filter((task) => task.status === 'active' && task.nextRunAt && task.nextRunAt.getTime() <= now).length;
  }
  const diagnostic: ScheduledTaskRuntimeDiagnostic = {
    ready: true,
    activeTasks,
    leasedTasks,
    dueTasks,
  };
  lastSchedulerDiagnosticSnapshot = diagnostic;
  return diagnostic;
}

export function getLastScheduledTaskRuntimeDiagnosticSnapshot(): ScheduledTaskRuntimeDiagnostic | null {
  return lastSchedulerDiagnosticSnapshot;
}
