import { describe, expect, it } from 'vitest';
import { collectPendingAdminActionIds, collectPendingAdminActions } from '@/features/agent-runtime/pendingApprovals';

describe('pendingApprovals helpers', () => {
  it('collects pending approval action metadata from tool results', () => {
    const actions = collectPendingAdminActions([
      {
        name: 'discord_admin',
        success: true,
        result: { status: 'pending_approval', actionId: 'action-1', coalesced: true },
        latencyMs: 10,
      },
      {
        name: 'discord_admin',
        success: true,
        result: { status: 'pending_approval', actionId: ' action-2 ' },
        latencyMs: 7,
      },
    ]);

    expect(actions).toEqual([
      { actionId: 'action-1', coalesced: true },
      { actionId: 'action-2', coalesced: false },
    ]);
  });

  it('collects pending approval action ids from tool results', () => {
    const ids = collectPendingAdminActionIds([
      {
        name: 'discord_admin',
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
        name: 'discord_admin',
        success: true,
        result: { status: 'pending_approval', actionId: ' action-2 ' },
        latencyMs: 7,
      },
      {
        name: 'discord_admin',
        success: false,
        error: 'nope',
        latencyMs: 1,
      },
      {
        name: 'discord_admin',
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
        name: 'discord_admin',
        success: true,
        result: { ok: true },
        latencyMs: 1,
      },
    ]);

    expect(ids).toEqual([]);
  });
});
