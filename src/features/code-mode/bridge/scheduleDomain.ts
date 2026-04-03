import { z } from 'zod';
import {
  assertValidTimezone,
  buildScheduledTaskDedupeKey,
  computeFirstScheduledRun,
  computeNextRecurringRun,
} from '../../scheduler/schedule';
import {
  getScheduledTaskById,
  listScheduledTaskRuns,
  listScheduledTasksByGuild,
  markScheduledTaskRunStart,
  upsertScheduledTask,
  updateScheduledTaskState,
  cancelScheduledTask,
} from '../../scheduler/scheduledTaskRepo';
import type {
  AgentRunPayload,
  ReminderMessagePayload,
  ScheduledTaskPayload,
  ScheduledTaskRecord,
} from '../../scheduler/types';
import {
  assertBridgeAccess,
  defineBridgeMethod,
  fetchWritableTextChannel,
  requireGuildId,
} from './common';

function serializeTask(task: ScheduledTaskRecord) {
  return {
    ...task,
    runAt: task.runAt?.toISOString() ?? null,
    nextRunAt: task.nextRunAt?.toISOString() ?? null,
    skipUntil: task.skipUntil?.toISOString() ?? null,
    lastRunAt: task.lastRunAt?.toISOString() ?? null,
    lastSuccessAt: task.lastSuccessAt?.toISOString() ?? null,
    leaseExpiresAt: task.leaseExpiresAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function serializeTaskRuns(runs: Awaited<ReturnType<typeof listScheduledTaskRuns>>) {
  return runs.map((run) => ({
    ...run,
    scheduledFor: run.scheduledFor.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  }));
}

function readReminderPayload(value: unknown): ReminderMessagePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Reminder payload is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.content !== 'string') {
    throw new Error('Reminder payload is invalid.');
  }
  return {
    kind: 'reminder_message',
    content: record.content as string,
    roleIds: Array.isArray(record.roleIds)
      ? record.roleIds.filter((entry): entry is string => typeof entry === 'string')
      : [],
    userIds: Array.isArray(record.userIds)
      ? record.userIds.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

function readAgentRunPayload(value: unknown): AgentRunPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Agent-run payload is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.prompt !== 'string') {
    throw new Error('Agent-run payload is invalid.');
  }
  return {
    kind: 'agent_run',
    prompt: record.prompt as string,
    mentionedUserIds: Array.isArray(record.mentionedUserIds)
      ? record.mentionedUserIds.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

function normalizePayload(params: {
  existing: ScheduledTaskRecord | null;
  reminder?: {
    content: string;
    roleIds?: string[];
    userIds?: string[];
  };
  agentRun?: {
    prompt: string;
    mentionedUserIds?: string[];
  };
}): ScheduledTaskPayload {
  if (params.reminder && params.agentRun) {
    throw new Error('Provide exactly one payload type: reminder or agentRun.');
  }
  if (params.reminder) {
    return {
      kind: 'reminder_message',
      content: params.reminder.content,
      roleIds: params.reminder.roleIds,
      userIds: params.reminder.userIds,
    };
  }
  if (params.agentRun) {
    return {
      kind: 'agent_run',
      prompt: params.agentRun.prompt,
      mentionedUserIds: params.agentRun.mentionedUserIds,
    };
  }
  if (!params.existing) {
    throw new Error('Provide either reminder or agentRun payload.');
  }
  return params.existing.payloadJson.kind === 'reminder_message'
    ? readReminderPayload(params.existing.payloadJson)
    : readAgentRunPayload(params.existing.payloadJson);
}

function resolveSchedule(mutated: {
  existing: ScheduledTaskRecord | null;
  timezone?: string;
  cronExpr?: string | null;
  runAtIso?: string | null;
}) {
  const timezone = assertValidTimezone(mutated.timezone?.trim() || mutated.existing?.timezone || 'UTC');
  const cronExpr =
    mutated.cronExpr !== undefined
      ? (mutated.cronExpr?.trim() || null)
      : mutated.existing?.cronExpr ?? null;
  const runAt =
    mutated.runAtIso !== undefined
      ? (mutated.runAtIso ? new Date(mutated.runAtIso) : null)
      : mutated.existing?.runAt ?? null;
  const nextRunAt = computeFirstScheduledRun({
    timezone,
    cronExpr,
    runAt,
  });
  return { timezone, cronExpr, runAt, nextRunAt };
}

async function requireGuildTask(params: { guildId: string; jobId: string }) {
  const task = await getScheduledTaskById(params.jobId);
  if (!task || task.guildId !== params.guildId) {
    throw new Error('Scheduled job not found.');
  }
  return task;
}

export const scheduleDomainMethods = [
  defineBridgeMethod({
    namespace: 'schedule',
    method: 'jobs.get',
    summary: 'Read one scheduled job and its recent run history.',
    input: z.object({
      jobId: z.string().trim().min(1),
    }),
    mutability: 'read',
    access: 'admin',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const task = await requireGuildTask({
        guildId: requireGuildId(context.toolContext),
        jobId: args.jobId,
      });
      const runs = await listScheduledTaskRuns({
        taskId: task.id,
        limit: 10,
      });
      return {
        task: serializeTask(task),
        recentRuns: serializeTaskRuns(runs),
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'schedule',
    method: 'jobs.list',
    summary: 'List scheduled jobs for the active guild.',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
    }),
    mutability: 'read',
    access: 'admin',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const guildId = args.guildId ?? requireGuildId(context.toolContext);
      const tasks = await listScheduledTasksByGuild(guildId);
      return tasks.map((task) => serializeTask(task));
    },
  }),
  defineBridgeMethod({
    namespace: 'schedule',
    method: 'jobs.create',
    summary: 'Create a new scheduled reminder or agent run.',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
      channelId: z.string().trim().min(1),
      timezone: z.string().trim().min(1),
      cronExpr: z.string().trim().min(1).optional(),
      runAtIso: z.string().trim().datetime().optional(),
      reminder: z.object({
        content: z.string().trim().min(1).max(4_000),
        roleIds: z.array(z.string().trim().min(1)).optional(),
        userIds: z.array(z.string().trim().min(1)).optional(),
      }).optional(),
      agentRun: z.object({
        prompt: z.string().trim().min(1).max(8_000),
        mentionedUserIds: z.array(z.string().trim().min(1)).optional(),
      }).optional(),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const guildId = args.guildId ?? requireGuildId(context.toolContext);
      await fetchWritableTextChannel({
        toolContext: context.toolContext,
        channelId: args.channelId,
      });
      const payload = normalizePayload({
        existing: null,
        reminder: args.reminder,
        agentRun: args.agentRun,
      });
      const schedule = resolveSchedule({
        existing: null,
        timezone: args.timezone,
        cronExpr: args.cronExpr,
        runAtIso: args.runAtIso,
      });
      const task = await upsertScheduledTask({
        guildId,
        channelId: args.channelId,
        createdByUserId: context.toolContext.userId,
        kind: payload.kind,
        status: 'active',
        timezone: schedule.timezone,
        cronExpr: schedule.cronExpr,
        runAt: schedule.runAt,
        nextRunAt: schedule.nextRunAt,
        payloadJson: payload,
        provenanceJson: {
          source: 'code_mode_bridge',
          requestedByUserId: context.toolContext.userId,
          invokerAuthority: context.toolContext.invokerAuthority ?? 'member',
          isAdmin: context.toolContext.invokerIsAdmin ?? false,
          canModerate: context.toolContext.invokerCanModerate ?? false,
        },
      });
      return serializeTask(task);
    },
  }),
  defineBridgeMethod({
    namespace: 'schedule',
    method: 'jobs.update',
    summary: 'Update a scheduled job while preserving its single payload kind.',
    input: z.object({
      jobId: z.string().trim().min(1),
      channelId: z.string().trim().min(1).optional(),
      timezone: z.string().trim().min(1).optional(),
      cronExpr: z.string().trim().min(1).nullable().optional(),
      runAtIso: z.string().trim().datetime().nullable().optional(),
      reminder: z.object({
        content: z.string().trim().min(1).max(4_000),
        roleIds: z.array(z.string().trim().min(1)).optional(),
        userIds: z.array(z.string().trim().min(1)).optional(),
      }).optional(),
      agentRun: z.object({
        prompt: z.string().trim().min(1).max(8_000),
        mentionedUserIds: z.array(z.string().trim().min(1)).optional(),
      }).optional(),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const guildId = requireGuildId(context.toolContext);
      const existing = await requireGuildTask({
        guildId,
        jobId: args.jobId,
      });
      const nextChannelId = args.channelId ?? existing.channelId;
      await fetchWritableTextChannel({
        toolContext: context.toolContext,
        channelId: nextChannelId,
      });
      const payload = normalizePayload({
        existing,
        reminder: args.reminder,
        agentRun: args.agentRun,
      });
      const schedule = resolveSchedule({
        existing,
        timezone: args.timezone,
        cronExpr: args.cronExpr,
        runAtIso: args.runAtIso,
      });
      const updated = await upsertScheduledTask({
        id: existing.id,
        guildId: existing.guildId,
        channelId: nextChannelId,
        createdByUserId: existing.createdByUserId,
        kind: payload.kind,
        status: existing.status,
        timezone: schedule.timezone,
        cronExpr: schedule.cronExpr,
        runAt: schedule.runAt,
        nextRunAt: schedule.nextRunAt,
        skipUntil: existing.status === 'paused' ? existing.skipUntil : null,
        payloadJson: payload,
        provenanceJson: existing.provenanceJson,
      });
      return serializeTask(updated);
    },
  }),
  defineBridgeMethod({
    namespace: 'schedule',
    method: 'jobs.pause',
    summary: 'Pause a scheduled job without deleting it.',
    input: z.object({
      jobId: z.string().trim().min(1),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const task = await requireGuildTask({
        guildId: requireGuildId(context.toolContext),
        jobId: args.jobId,
      });
      return serializeTask(await updateScheduledTaskState({
        id: task.id,
        status: 'paused',
      }));
    },
  }),
  defineBridgeMethod({
    namespace: 'schedule',
    method: 'jobs.resume',
    summary: 'Resume a paused scheduled job and recalculate its next run time.',
    input: z.object({
      jobId: z.string().trim().min(1),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const task = await requireGuildTask({
        guildId: requireGuildId(context.toolContext),
        jobId: args.jobId,
      });
      const baseTime = task.nextRunAt ?? task.runAt ?? new Date();
      const nextRunAt = task.cronExpr
        ? computeNextRecurringRun({
            cronExpr: task.cronExpr,
            timezone: task.timezone,
            from: baseTime,
          })
        : task.runAt;
      return serializeTask(await updateScheduledTaskState({
        id: task.id,
        status: 'active',
        nextRunAt,
        skipUntil: null,
      }));
    },
  }),
  defineBridgeMethod({
    namespace: 'schedule',
    method: 'jobs.cancel',
    summary: 'Cancel a scheduled job and stop future runs.',
    input: z.object({
      jobId: z.string().trim().min(1),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const task = await requireGuildTask({
        guildId: requireGuildId(context.toolContext),
        jobId: args.jobId,
      });
      return serializeTask(await cancelScheduledTask(task.id));
    },
  }),
  defineBridgeMethod({
    namespace: 'schedule',
    method: 'jobs.run',
    summary: 'Queue an immediate run record for a scheduled job.',
    input: z.object({
      jobId: z.string().trim().min(1),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const task = await requireGuildTask({
        guildId: requireGuildId(context.toolContext),
        jobId: args.jobId,
      });
      const scheduledFor = new Date();
      const run = await markScheduledTaskRunStart({
        taskId: task.id,
        dedupeKey: buildScheduledTaskDedupeKey(task.id, scheduledFor),
        scheduledFor,
      });
      return {
        task: serializeTask(task),
        run: {
          ...run.run,
          scheduledFor: run.run.scheduledFor.toISOString(),
          startedAt: run.run.startedAt?.toISOString() ?? null,
          finishedAt: run.run.finishedAt?.toISOString() ?? null,
          createdAt: run.run.createdAt.toISOString(),
          updatedAt: run.run.updatedAt.toISOString(),
        },
      };
    },
  }),
  defineBridgeMethod({
    namespace: 'schedule',
    method: 'jobs.runs',
    summary: 'List recent run records for one scheduled job.',
    input: z.object({
      jobId: z.string().trim().min(1),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    mutability: 'read',
    access: 'admin',
    async execute(args, context) {
      assertBridgeAccess(context.toolContext, 'admin');
      const task = await requireGuildTask({
        guildId: requireGuildId(context.toolContext),
        jobId: args.jobId,
      });
      const runs = await listScheduledTaskRuns({
        taskId: task.id,
        limit: args.limit ?? 10,
      });
      return serializeTaskRuns(runs);
    },
  }),
];
