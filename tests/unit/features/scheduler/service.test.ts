import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduledTaskRecord, ScheduledTaskRunRecord } from '@/features/scheduler/types';

const channelFetch = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => ({
  channels: {
    fetch: channelFetch,
  },
  guilds: {
    cache: [],
  },
  user: {
    id: 'sage-bot',
  },
}));
const logger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
const getGuildTimezone = vi.hoisted(() => vi.fn());
const setGuildTimezone = vi.hoisted(() => vi.fn());
const cancelScheduledTask = vi.hoisted(() => vi.fn());
const completeScheduledTask = vi.hoisted(() => vi.fn());
const completeScheduledTaskRun = vi.hoisted(() => vi.fn());
const getScheduledTaskById = vi.hoisted(() => vi.fn());
const listScheduledTaskRuns = vi.hoisted(() => vi.fn());
const listScheduledTasksByGuild = vi.hoisted(() => vi.fn());
const markScheduledTaskRunStart = vi.hoisted(() => vi.fn());
const upsertScheduledTask = vi.hoisted(() => vi.fn());

vi.mock('@/platform/discord/client', () => ({
  client,
}));

vi.mock('@/platform/logging/logger', () => ({
  logger,
}));

vi.mock('@/features/settings/guildSettingsRepo', () => ({
  getGuildTimezone,
  setGuildTimezone,
}));

vi.mock('@/features/scheduler/scheduledTaskRepo', () => ({
  cancelScheduledTask,
  completeScheduledTask,
  completeScheduledTaskRun,
  getScheduledTaskById,
  listScheduledTaskRuns,
  listScheduledTasksByGuild,
  markScheduledTaskRunStart,
  upsertScheduledTask,
}));

function createTask(overrides: Partial<ScheduledTaskRecord> = {}): ScheduledTaskRecord {
  return {
    id: 'task-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    createdByUserId: 'user-1',
    kind: 'reminder_message',
    status: 'active',
    timezone: 'UTC',
    cronExpr: null,
    runAt: null,
    nextRunAt: new Date('2026-03-23T10:00:00.000Z'),
    lastRunAt: null,
    lastSuccessAt: null,
    leaseOwner: 'scheduler',
    leaseExpiresAt: null,
    payloadJson: {
      kind: 'reminder_message',
      content: 'Remember the standup',
      roleIds: ['role-1'],
      userIds: ['user-2'],
    },
    provenanceJson: {
      source: 'discord_admin_tool',
    },
    lastErrorText: null,
    createdAt: new Date('2026-03-23T09:00:00.000Z'),
    updatedAt: new Date('2026-03-23T09:00:00.000Z'),
    ...overrides,
  };
}

function createRun(overrides: Partial<ScheduledTaskRunRecord> = {}): ScheduledTaskRunRecord {
  return {
    id: 'run-1',
    taskId: 'task-1',
    dedupeKey: 'task-1:2026-03-23T10:00:00.000Z',
    status: 'running',
    scheduledFor: new Date('2026-03-23T10:00:00.000Z'),
    startedAt: new Date('2026-03-23T10:00:00.000Z'),
    finishedAt: null,
    errorText: null,
    resultJson: null,
    createdAt: new Date('2026-03-23T10:00:00.000Z'),
    updatedAt: new Date('2026-03-23T10:00:00.000Z'),
    ...overrides,
  };
}

describe('scheduler service red-team regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listScheduledTasksByGuild.mockResolvedValue([]);
    getGuildTimezone.mockResolvedValue(null);
    setGuildTimezone.mockResolvedValue(undefined);
    upsertScheduledTask.mockResolvedValue(createTask());
    markScheduledTaskRunStart.mockResolvedValue({
      created: true,
      run: createRun(),
    });
    completeScheduledTaskRun.mockResolvedValue(undefined);
    completeScheduledTask.mockResolvedValue(undefined);
    channelFetch.mockResolvedValue({
      id: 'channel-1',
      guildId: 'guild-1',
      isDMBased: () => false,
      isTextBased: () => true,
      send: vi.fn().mockResolvedValue({ id: 'message-1' }),
    });
  });

  it('validates explicit timezones before persisting them as guild defaults', async () => {
    const { upsertScheduledTaskForTool } = await import('@/features/scheduler/service');

    await expect(
      upsertScheduledTaskForTool({
        guildId: 'guild-1',
        requestedByUserId: 'user-1',
        kind: 'reminder_message',
        channelId: 'channel-1',
        timezone: 'Mars/Olympus',
        payload: {
          kind: 'reminder_message',
          content: 'Reminder',
        },
      }),
    ).rejects.toThrow();

    expect(setGuildTimezone).not.toHaveBeenCalled();
    expect(upsertScheduledTask).not.toHaveBeenCalled();
  });

  it('does not persist an explicit guild timezone when the scheduled task write fails', async () => {
    upsertScheduledTask.mockRejectedValue(new Error('task write failed'));

    const { upsertScheduledTaskForTool } = await import('@/features/scheduler/service');

    await expect(
      upsertScheduledTaskForTool({
        guildId: 'guild-1',
        requestedByUserId: 'user-1',
        kind: 'reminder_message',
        channelId: 'channel-1',
        timezone: 'Asia/Kuala_Lumpur',
        runAtIso: '2026-03-23T10:00:00.000Z',
        payload: {
          kind: 'reminder_message',
          content: 'Reminder',
        },
      }),
    ).rejects.toThrow('task write failed');

    expect(setGuildTimezone).not.toHaveBeenCalled();
  });

  it('rejects scheduled task updates when the task id belongs to another guild', async () => {
    getScheduledTaskById.mockResolvedValue(
      createTask({
        id: 'task-2',
        guildId: 'guild-2',
      }),
    );

    const { upsertScheduledTaskForTool } = await import('@/features/scheduler/service');

    await expect(
      upsertScheduledTaskForTool({
        guildId: 'guild-1',
        requestedByUserId: 'user-1',
        taskId: 'task-2',
        kind: 'reminder_message',
        channelId: 'channel-1',
        payload: {
          kind: 'reminder_message',
          content: 'Reminder',
        },
      }),
    ).rejects.toThrow('Scheduled task not found.');

    expect(upsertScheduledTask).not.toHaveBeenCalled();
  });

  it('rejects scheduled tasks targeting channels outside the active guild', async () => {
    channelFetch.mockResolvedValue({
      id: 'channel-2',
      guildId: 'guild-2',
      isDMBased: () => false,
      isTextBased: () => true,
      send: vi.fn(),
    });

    const { upsertScheduledTaskForTool } = await import('@/features/scheduler/service');

    await expect(
      upsertScheduledTaskForTool({
        guildId: 'guild-1',
        requestedByUserId: 'user-1',
        kind: 'reminder_message',
        channelId: 'channel-2',
        payload: {
          kind: 'reminder_message',
          content: 'Reminder',
        },
      }),
    ).rejects.toThrow('Scheduled task target channel must belong to the active guild.');

    expect(upsertScheduledTask).not.toHaveBeenCalled();
  });

  it('fails reminder execution when the stored channel no longer belongs to the task guild', async () => {
    channelFetch.mockResolvedValue({
      id: 'channel-2',
      guildId: 'guild-2',
      isDMBased: () => false,
      isTextBased: () => true,
      send: vi.fn(),
    });

    const { executeScheduledTask } = await import('@/features/scheduler/service');

    await expect(
      executeScheduledTask(
        createTask({
          channelId: 'channel-2',
        }),
      ),
    ).rejects.toThrow('Scheduled task target channel must belong to the active guild.');

    expect(completeScheduledTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'run-1',
        status: 'failed',
        errorText: 'Scheduled task target channel must belong to the active guild.',
      }),
    );
    expect(completeScheduledTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-1',
        succeeded: false,
        lastErrorText: 'Scheduled task target channel must belong to the active guild.',
      }),
    );
  });
});
