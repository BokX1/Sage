import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsertModerationPolicyForTool = vi.hoisted(() => vi.fn());
const disableModerationPolicyForTool = vi.hoisted(() => vi.fn());
const listModerationCasesForTool = vi.hoisted(() => vi.fn());
const listModerationPoliciesForTool = vi.hoisted(() => vi.fn());
const getModerationPolicyForTool = vi.hoisted(() => vi.fn());
const upsertScheduledTaskForTool = vi.hoisted(() => vi.fn());
const cancelScheduledTaskForTool = vi.hoisted(() => vi.fn());
const listScheduledTasksForTool = vi.hoisted(() => vi.fn());
const getScheduledTaskForTool = vi.hoisted(() => vi.fn());

vi.mock('@/features/moderation/runtime', () => ({
  upsertModerationPolicyForTool,
  disableModerationPolicyForTool,
  listModerationCasesForTool,
  listModerationPoliciesForTool,
  getModerationPolicyForTool,
}));

vi.mock('@/features/scheduler/service', () => ({
  upsertScheduledTaskForTool,
  cancelScheduledTaskForTool,
  listScheduledTasksForTool,
  getScheduledTaskForTool,
}));

describe('executeDiscordAdminAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertModerationPolicyForTool.mockResolvedValue({ ok: true });
  });

  it(
    'forwards policyId to moderation policy upserts so edits can target the existing policy identity',
    async () => {
    const { executeDiscordAdminAction } = await import('@/features/agent-runtime/discord/core');

    await executeDiscordAdminAction(
      {
        action: 'upsert_moderation_policy',
        policyId: 'policy-123',
        name: 'Rename policy',
        mode: 'enforce',
        spec: {
          family: 'content_filter',
          trigger: {
            kind: 'keyword_filter',
            keywords: ['spoiler'],
          },
          action: {
            type: 'alert_mods',
          },
        },
      },
      {
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'user-1',
        invokerIsAdmin: true,
      } as never,
    );

    expect(upsertModerationPolicyForTool).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        requestedByUserId: 'user-1',
        policyId: 'policy-123',
        name: 'Rename policy',
      }),
    );
    },
    15_000,
  );
});
