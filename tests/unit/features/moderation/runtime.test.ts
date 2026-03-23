import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CompiledModerationPolicy,
  ModerationPolicyRecord,
  ModerationPolicySpec,
} from '@/features/moderation/types';

const channelFetch = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => ({
  channels: {
    fetch: channelFetch,
  },
  options: {
    intents: 0,
  },
}));
const logger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
const executeAutonomousModerationAction = vi.hoisted(() => vi.fn());
const compileModerationPolicy = vi.hoisted(() => vi.fn());
const createModerationCase = vi.hoisted(() => vi.fn());
const getModerationPolicyById = vi.hoisted(() => vi.fn());
const getModerationPolicyByGuildName = vi.hoisted(() => vi.fn());
const listModerationCasesByGuild = vi.hoisted(() => vi.fn());
const listModerationPoliciesByGuild = vi.hoisted(() => vi.fn());
const markModerationCaseResolved = vi.hoisted(() => vi.fn());
const upsertModerationPolicy = vi.hoisted(() => vi.fn());
const importExternalDiscordAutoModerationRules = vi.hoisted(() => vi.fn());
const syncSageModerationPolicyToDiscord = vi.hoisted(() => vi.fn());

vi.mock('@/platform/discord/client', () => ({
  client,
}));

vi.mock('@/platform/logging/logger', () => ({
  logger,
}));

vi.mock('@/features/admin/adminActionService', () => ({
  executeAutonomousModerationAction,
}));

vi.mock('@/features/moderation/compiler', () => ({
  compileModerationPolicy,
}));

vi.mock('@/features/moderation/moderationPolicyRepo', () => ({
  createModerationCase,
  getModerationPolicyById,
  getModerationPolicyByGuildName,
  listModerationCasesByGuild,
  listModerationPoliciesByGuild,
  markModerationCaseResolved,
  upsertModerationPolicy,
}));

vi.mock('@/features/moderation/automodSync', () => ({
  importExternalDiscordAutoModerationRules,
  syncSageModerationPolicyToDiscord,
}));

function createCompiledPolicy(overrides: Partial<CompiledModerationPolicy> = {}): CompiledModerationPolicy {
  return {
    backend: 'native_discord_automod',
    nativeRule: {
      name: '[Sage] policy',
      eventType: 'message_send',
      triggerKind: 'keyword',
      keywordFilter: ['spoiler'],
      blockMessage: true,
      alertChannelId: null,
      customMessage: null,
      timeoutSeconds: null,
    },
    runtimeRule: null,
    ...overrides,
  };
}

function createPolicySpec(overrides: Partial<ModerationPolicySpec> = {}): ModerationPolicySpec {
  return {
    family: 'content_filter',
    trigger: {
      kind: 'keyword_filter',
      keywords: ['spoiler'],
    },
    action: {
      type: 'alert_mods',
    },
    notifyChannelId: 'channel-1',
    ...overrides,
  };
}

function createPolicyRecord(overrides: Partial<ModerationPolicyRecord> = {}): ModerationPolicyRecord {
  const compiledPolicyJson = createCompiledPolicy();
  const policySpecJson = createPolicySpec();
  return {
    id: 'policy-1',
    guildId: 'guild-1',
    name: 'Spoiler Guard',
    descriptionText: null,
    family: policySpecJson.family,
    backend: compiledPolicyJson.backend,
    ownership: 'sage_managed',
    mode: 'enforce',
    version: 2,
    createdByUserId: 'creator-1',
    updatedByUserId: 'editor-1',
    externalRuleId: 'rule-1',
    notifyChannelId: policySpecJson.notifyChannelId ?? null,
    policySpecJson,
    compiledPolicyJson,
    lastSyncedAt: null,
    lastConflictText: null,
    createdAt: new Date('2026-03-23T04:00:00.000Z'),
    updatedAt: new Date('2026-03-23T04:00:00.000Z'),
    ...overrides,
  };
}

describe('moderation runtime red-team regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compileModerationPolicy.mockReturnValue(createCompiledPolicy());
    syncSageModerationPolicyToDiscord.mockResolvedValue({
      externalRuleId: 'rule-1',
      lastSyncedAt: new Date('2026-03-23T04:30:00.000Z'),
      lastConflictText: null,
    });
    channelFetch.mockResolvedValue({
      id: 'channel-1',
      guildId: 'guild-1',
      isDMBased: () => false,
      isTextBased: () => true,
      send: vi.fn(),
    });
  });

  it('updates an existing moderation policy by id so renames keep the same policy identity', async () => {
    const existing = createPolicyRecord();
    getModerationPolicyById.mockResolvedValue(existing);
    upsertModerationPolicy
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(
        createPolicyRecord({
          name: 'Renamed Guard',
          externalRuleId: 'rule-2',
        }),
      );

    const { upsertModerationPolicyForTool } = await import('@/features/moderation/runtime');

    await upsertModerationPolicyForTool({
      guildId: 'guild-1',
      requestedByUserId: 'editor-2',
      policyId: existing.id,
      name: 'Renamed Guard',
      descriptionText: 'Updated policy',
      mode: 'enforce',
      spec: createPolicySpec(),
    });

    expect(upsertModerationPolicy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: existing.id,
        name: 'Renamed Guard',
        createdByUserId: existing.createdByUserId,
      }),
    );
    expect(syncSageModerationPolicyToDiscord).toHaveBeenCalledWith({
      policyId: existing.id,
    });
  });

  it('fails closed when disabling a policy if Discord AutoMod sync fails', async () => {
    const policy = createPolicyRecord();
    getModerationPolicyById.mockResolvedValue(policy);
    syncSageModerationPolicyToDiscord.mockRejectedValue(new Error('discord sync failed'));

    const { disableModerationPolicyForTool } = await import('@/features/moderation/runtime');

    await expect(
      disableModerationPolicyForTool({
        guildId: 'guild-1',
        requestedByUserId: 'editor-2',
        policyId: policy.id,
      }),
    ).rejects.toThrow('discord sync failed');

    expect(upsertModerationPolicy).not.toHaveBeenCalled();
  });

  it('rejects notify channels outside the active guild before writing policy changes', async () => {
    getModerationPolicyById.mockResolvedValue(null);
    channelFetch.mockResolvedValue({
      id: 'channel-2',
      guildId: 'guild-2',
      isDMBased: () => false,
      isTextBased: () => true,
      send: vi.fn(),
    });

    const { upsertModerationPolicyForTool } = await import('@/features/moderation/runtime');

    await expect(
      upsertModerationPolicyForTool({
        guildId: 'guild-1',
        requestedByUserId: 'editor-2',
        name: 'Spoiler Guard',
        descriptionText: null,
        mode: 'dry_run',
        spec: createPolicySpec({
          notifyChannelId: 'channel-2',
        }),
      }),
    ).rejects.toThrow('notifyChannelId must point to a text channel in the active guild.');

    expect(upsertModerationPolicy).not.toHaveBeenCalled();
  });
});
