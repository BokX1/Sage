import { describe, expect, it } from 'vitest';

import {
  buildDoctorNextAction,
  classifyDoctorResults,
  type CheckResult,
} from '@/cli/doctor';

function makeResult(overrides: Partial<CheckResult>): CheckResult {
  return {
    id: 'env.files',
    title: 'Environment files',
    status: 'pass',
    message: 'ok',
    durationMs: 5,
    ...overrides,
  };
}

describe('doctor helpers', () => {
  it('groups results into blocking, recommended, optional, and passing buckets', () => {
    const grouped = classifyDoctorResults([
      makeResult({ id: 'env.files', status: 'fail' }),
      makeResult({ id: 'services.tika', status: 'warn' }),
      makeResult({ id: 'ai_provider.ping', status: 'skip' }),
      makeResult({ id: 'runtime.node', status: 'pass' }),
    ]);

    expect(grouped.blocking).toHaveLength(1);
    expect(grouped.recommended).toHaveLength(1);
    expect(grouped.optional).toHaveLength(1);
    expect(grouped.passing).toHaveLength(1);
  });

  it('prioritizes the highest-impact next action from failures', () => {
    const nextAction = buildDoctorNextAction([
      makeResult({
        id: 'db.connect',
        status: 'fail',
        message: 'database offline',
      }),
      makeResult({
        id: 'services.tika',
        status: 'warn',
        message: 'tika unreachable',
      }),
    ]);

    expect(nextAction).toContain('Start the database service');
  });

  it('points tool-calling probe failures to the dedicated provider probe command', () => {
    const nextAction = buildDoctorNextAction([
      makeResult({
        id: 'ai_provider.tool_calls',
        status: 'fail',
        message: 'tool-calling probe failed',
      }),
    ]);

    expect(nextAction).toContain('npm run ai-provider:probe');
  });

  it('falls back to warning guidance when there are no blocking failures', () => {
    const nextAction = buildDoctorNextAction([
      makeResult({
        id: 'env.templateSync',
        status: 'warn',
        message: 'template drift detected',
      }),
    ]);

    expect(nextAction).toContain('Sync your `.env` with `.env.example`');
  });

  it('returns a ready message when there are no failures or warnings', () => {
    const nextAction = buildDoctorNextAction([
      makeResult({ id: 'runtime.node', status: 'pass', message: 'node ok' }),
      makeResult({ id: 'ai_provider.ping', status: 'skip', message: 'not enabled' }),
    ]);

    expect(nextAction).toBe('No immediate action needed. Sage looks ready.');
  });
});
