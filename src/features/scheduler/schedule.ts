import { CronExpressionParser } from 'cron-parser';

const MINIMUM_RECURRING_INTERVAL_MINUTES = 5;

export function assertValidTimezone(timezone: string): string {
  const normalized = timezone.trim();
  if (!normalized) {
    throw new Error('timezone is required.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized });
    return normalized;
  } catch {
    throw new Error('timezone must be a valid IANA timezone, such as UTC or Asia/Kuala_Lumpur.');
  }
}

export function normalizeCronExpression(expr: string): string {
  const normalized = expr.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    throw new Error('cron expression is required.');
  }
  return normalized;
}

export function computeFirstScheduledRun(params: {
  timezone: string;
  cronExpr?: string | null;
  runAt?: Date | null;
  now?: Date;
}): Date {
  const now = params.now ?? new Date();
  if (params.runAt) {
    if (params.runAt.getTime() <= now.getTime()) {
      throw new Error('runAt must be in the future.');
    }
    return params.runAt;
  }
  if (!params.cronExpr) {
    throw new Error('Either runAt or cronExpr is required.');
  }
  const cronExpr = normalizeCronExpression(params.cronExpr);
  const interval = CronExpressionParser.parse(cronExpr, {
    currentDate: now,
    tz: assertValidTimezone(params.timezone),
  });
  const next = interval.next().toDate();
  assertCronCadenceFloor({ cronExpr, timezone: params.timezone, now, next });
  return next;
}

export function computeNextRecurringRun(params: {
  cronExpr: string;
  timezone: string;
  from: Date;
}): Date {
  const cronExpr = normalizeCronExpression(params.cronExpr);
  const interval = CronExpressionParser.parse(cronExpr, {
    currentDate: params.from,
    tz: assertValidTimezone(params.timezone),
  });
  const next = interval.next().toDate();
  assertCronCadenceFloor({ cronExpr, timezone: params.timezone, now: params.from, next });
  return next;
}

function assertCronCadenceFloor(params: {
  cronExpr: string;
  timezone: string;
  now: Date;
  next: Date;
}) {
  const interval = CronExpressionParser.parse(params.cronExpr, {
    currentDate: params.next,
    tz: assertValidTimezone(params.timezone),
  });
  const nextAfter = interval.next().toDate();
  const cadenceMinutes = (nextAfter.getTime() - params.next.getTime()) / 60_000;
  if (cadenceMinutes < MINIMUM_RECURRING_INTERVAL_MINUTES) {
    throw new Error(`Recurring schedules must be at least every ${MINIMUM_RECURRING_INTERVAL_MINUTES} minutes.`);
  }
  if (params.next.getTime() <= params.now.getTime()) {
    throw new Error('Recurring schedule must resolve to a future execution time.');
  }
}

export function buildScheduledTaskDedupeKey(taskId: string, scheduledFor: Date): string {
  return `${taskId}:${scheduledFor.toISOString()}`;
}

export function sanitizeReminderMentions(params: {
  roleIds?: string[];
  userIds?: string[];
}) {
  const roleIds = (params.roleIds ?? []).filter((value) => value !== 'everyone' && value !== 'here');
  const userIds = params.userIds ?? [];
  return {
    roleIds,
    userIds,
  };
}

export const scheduledTaskRuntimeDefaults = {
  leaseTtlMs: 30_000,
  pollMs: 5_000,
  maxTasksPerGuild: 50,
};
