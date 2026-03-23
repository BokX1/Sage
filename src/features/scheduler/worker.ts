import { randomUUID } from 'node:crypto';

import { client } from '../../platform/discord/client';
import { logger } from '../../platform/logging/logger';
import { listDueScheduledTasks } from './scheduledTaskRepo';
import { executeScheduledTask } from './service';
import { scheduledTaskRuntimeDefaults } from './schedule';

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerTickInFlight = false;

async function tickScheduledTaskWorker(): Promise<void> {
  if (schedulerTickInFlight || !client.isReady()) {
    return;
  }
  schedulerTickInFlight = true;
  try {
    const now = new Date();
    const leaseOwner = `sage-scheduler:${process.pid}:${randomUUID()}`;
    const dueTasks = await listDueScheduledTasks({
      now,
      leaseOwner,
      leaseTtlMs: scheduledTaskRuntimeDefaults.leaseTtlMs,
      limit: 10,
    });

    for (const task of dueTasks) {
      await executeScheduledTask({
        ...task,
        leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + scheduledTaskRuntimeDefaults.leaseTtlMs),
      }).catch((error) => {
        logger.error({ error, taskId: task.id, guildId: task.guildId }, 'Scheduled task execution failed');
      });
    }
  } finally {
    schedulerTickInFlight = false;
  }
}

export function initScheduledTaskWorker(): void {
  if (schedulerTimer || process.env.VITEST_WORKER_ID !== undefined) {
    return;
  }
  schedulerTimer = setInterval(() => {
    void tickScheduledTaskWorker();
  }, scheduledTaskRuntimeDefaults.pollMs);
  schedulerTimer.unref();
}

export function stopScheduledTaskWorker(): void {
  if (!schedulerTimer) {
    return;
  }
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}

export function __resetScheduledTaskWorkerForTests(): void {
  stopScheduledTaskWorker();
  schedulerTickInFlight = false;
}
