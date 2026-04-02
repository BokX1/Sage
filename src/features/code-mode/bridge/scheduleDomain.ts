import { z } from 'zod';
import {
  buildScheduledTaskDedupeKey,
  computeFirstScheduledRun,
} from '../../scheduler/schedule';
import {
  cancelScheduledTask,
  getScheduledTaskById,
  listScheduledTaskRuns,
  listScheduledTasksByGuild,
  markScheduledTaskRunStart,
  upsertScheduledTask,
} from '../../scheduler/scheduledTaskRepo';
import type { AgentRunPayload, ReminderMessagePayload } from '../../scheduler/types';
import { defineBridgeMethod, fetchWritableTextChannel, requireGuildId } from './common';

function serializeTask(task: Awaited<ReturnType<typeof getScheduledTaskById>> extends infer T ? Exclude<T, null> : never) {
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

export const scheduleDomainMethods = [
  defineBridgeMethod({
    namespace: 'schedule',
    method: 'jobs.list',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
    }),
    mutability: 'read',
    access: 'admin',
    async execute(args, context) {
      const guildId = args.guildId ?? requireGuildId(context.toolContext);
      const tasks = await listScheduledTasksByGuild(guildId);
      return tasks.map((task) => serializeTask(task));
    },
  }),
  defineBridgeMethod({
    namespace: 'schedule',
    method: 'jobs.create',
    input: z.object({
      guildId: z.string().trim().min(1).optional(),
      channelId: z.string().trim().min(1),
      timezone: z.string().trim().min(1),
      cronExpr: z.string().trim().min(1).optional(),
      runAtIso: z.string().trim().datetime().optional(),
      reminder: z
        .object({
          content: z.string().trim().min(1).max(4_000),
          roleIds: z.array(z.string().trim().min(1)).optional(),
          userIds: z.array(z.string().trim().min(1)).optional(),
        })
        .optional(),
      agentRun: z
        .object({
          prompt: z.string().trim().min(1).max(8_000),
          mentionedUserIds: z.array(z.string().trim().min(1)).optional(),
        })
        .optional(),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args, context) {
      const guildId = args.guildId ?? requireGuildId(context.toolContext);
      await fetchWritableTextChannel({
        toolContext: context.toolContext,
        channelId: args.channelId,
      });
      if (!args.reminder && !args.agentRun) {
        throw new Error('Provide either reminder or agentRun payload.');
      }
      if (args.reminder && args.agentRun) {
        throw new Error('Only one scheduled payload type can be created at a time.');
      }
      const payload: ReminderMessagePayload | AgentRunPayload = args.reminder
        ? {
            kind: 'reminder_message',
            content: args.reminder.content,
            roleIds: args.reminder.roleIds,
            userIds: args.reminder.userIds,
          }
        : {
            kind: 'agent_run',
            prompt: args.agentRun!.prompt,
            mentionedUserIds: args.agentRun!.mentionedUserIds,
          };
      const runAt = args.runAtIso ? new Date(args.runAtIso) : null;
      const nextRunAt = computeFirstScheduledRun({
        timezone: args.timezone,
        cronExpr: args.cronExpr ?? null,
        runAt,
      });
      const task = await upsertScheduledTask({
        guildId,
        channelId: args.channelId,
        createdByUserId: context.toolContext.userId,
        kind: payload.kind,
        status: 'active',
        timezone: args.timezone,
        cronExpr: args.cronExpr ?? null,
        runAt,
        nextRunAt,
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
    method: 'jobs.cancel',
    input: z.object({
      jobId: z.string().trim().min(1),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args) {
      const task = await getScheduledTaskById(args.jobId);
      if (!task) {
        throw new Error('Scheduled job not found.');
      }
      return serializeTask(await cancelScheduledTask(task.id));
    },
  }),
  defineBridgeMethod({
    namespace: 'schedule',
    method: 'jobs.run',
    input: z.object({
      jobId: z.string().trim().min(1),
    }),
    mutability: 'write',
    access: 'admin',
    approvalMode: 'required',
    async execute(args) {
      const task = await getScheduledTaskById(args.jobId);
      if (!task) {
        throw new Error('Scheduled job not found.');
      }
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
    input: z.object({
      jobId: z.string().trim().min(1),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    mutability: 'read',
    access: 'admin',
    async execute(args) {
      const task = await getScheduledTaskById(args.jobId);
      if (!task) {
        throw new Error('Scheduled job not found.');
      }
      const runs = await listScheduledTaskRuns({
        taskId: task.id,
        limit: args.limit ?? 10,
      });
      return runs.map((run) => ({
        ...run,
        scheduledFor: run.scheduledFor.toISOString(),
        startedAt: run.startedAt?.toISOString() ?? null,
        finishedAt: run.finishedAt?.toISOString() ?? null,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
      }));
    },
  }),
];
