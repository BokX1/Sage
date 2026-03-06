import { describe, expect, it } from 'vitest';
import { collectPendingAdminActionIds } from '@/features/agent-runtime/pendingApprovals';

describe('collectPendingAdminActionIds', () => {
  it('collects pending approval action ids from tool results', () => {
    const ids = collectPendingAdminActionIds([
      {
        name: 'discord',
        success: true,
        result: { status: 'pending_approval', actionId: 'action-1' },
        latencyMs: 10,
      },
      {
        name: 'web',
        success: true,
        result: { status: 'ok' },
        latencyMs: 5,
      },
      {
        name: 'discord',
        success: true,
        result: { status: 'pending_approval', actionId: ' action-2 ' },
        latencyMs: 7,
      },
      {
        name: 'discord',
        success: false,
        error: 'nope',
        latencyMs: 1,
      },
      {
        name: 'discord',
        success: true,
        result: { status: 'pending_approval', actionId: 'action-1' },
        latencyMs: 2,
      },
    ]);

    expect(ids.sort()).toEqual(['action-1', 'action-2']);
  });

  it('returns an empty list when no pending approvals exist', () => {
    const ids = collectPendingAdminActionIds([
      {
        name: 'discord',
        success: true,
        result: { ok: true },
        latencyMs: 1,
      },
    ]);

    expect(ids).toEqual([]);
  });
});
