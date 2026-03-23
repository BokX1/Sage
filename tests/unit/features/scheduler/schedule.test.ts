import { describe, expect, it } from 'vitest';

import {
  assertValidTimezone,
  computeFirstScheduledRun,
  sanitizeReminderMentions,
} from '../../../../src/features/scheduler/schedule';

describe('scheduler schedule helpers', () => {
  it('rejects recurring schedules that fire more often than the five-minute floor', () => {
    expect(() =>
      computeFirstScheduledRun({
        timezone: 'UTC',
        cronExpr: '*/1 * * * *',
        now: new Date('2026-03-23T00:00:00.000Z'),
      }),
    ).toThrow('Recurring schedules must be at least every 5 minutes.');
  });

  it('filters @everyone and @here from reminder mentions while preserving explicit ids', () => {
    expect(
      sanitizeReminderMentions({
        roleIds: ['role-1', 'everyone', 'here', 'role-2'],
        userIds: ['user-1'],
      }),
    ).toEqual({
      roleIds: ['role-1', 'role-2'],
      userIds: ['user-1'],
    });
  });

  it('accepts valid IANA timezones for scheduled task storage', () => {
    expect(assertValidTimezone('Asia/Kuala_Lumpur')).toBe('Asia/Kuala_Lumpur');
  });
});
