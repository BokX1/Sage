import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  type AutoModerationRule,
  type AutoModerationRuleCreateOptions,
  type Guild,
} from 'discord.js';

import { client } from '../../platform/discord/client';
import {
  deleteMissingExternalModerationPolicies,
  getModerationPolicyById,
  upsertExternalModerationPolicy,
} from './moderationPolicyRepo';
import type {
  CompiledModerationPolicy,
  ModerationPolicyFamily,
  ModerationPolicyRecord,
  ModerationPolicySpec,
} from './types';

const SAGE_AUTOMOD_PREFIX = '[Sage] ';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function inferPolicyFamily(triggerType: number | null | undefined): ModerationPolicyFamily {
  if (triggerType === AutoModerationRuleTriggerType.MentionSpam || triggerType === AutoModerationRuleTriggerType.Spam) {
    return 'spam_filter';
  }
  return 'content_filter';
}

function buildExternalPolicySnapshot(rule: AutoModerationRule): {
  policySpecJson: ModerationPolicySpec;
  compiledPolicyJson: CompiledModerationPolicy;
  notifyChannelId: string | null;
} {
  const actions = Array.from(rule.actions.values());
  const timeoutAction = actions.find((action) => action.type === AutoModerationActionType.Timeout);
  const alertAction = actions.find((action) => action.type === AutoModerationActionType.SendAlertMessage);
  const blockAction = actions.find((action) => action.type === AutoModerationActionType.BlockMessage);
  const triggerMetadata = rule.triggerMetadata ?? null;
  const eventType =
    rule.triggerType === AutoModerationRuleTriggerType.MentionSpam
      ? 'mention_spam'
      : rule.triggerType === AutoModerationRuleTriggerType.Spam
        ? 'generic_spam'
        : 'keyword_filter';

  const policySpecJson: ModerationPolicySpec = {
    family: inferPolicyFamily(rule.triggerType),
    trigger:
      eventType === 'mention_spam'
        ? {
            kind: 'mention_spam',
            mentionTotalLimit: triggerMetadata?.mentionTotalLimit ?? 5,
          }
        : eventType === 'generic_spam'
          ? {
              kind: 'generic_spam',
            }
          : {
              kind: 'keyword_filter',
              keywords: [...(triggerMetadata?.keywordFilter ?? [])],
              allowList: [...(triggerMetadata?.allowList ?? [])],
            },
    action: timeoutAction
      ? {
          type: 'timeout_member',
          timeoutMinutes: Math.max(
            1,
            Math.round(((timeoutAction.metadata?.durationSeconds ?? 600) / 60)),
          ),
        }
      : blockAction
        ? { type: 'delete_or_block_message' }
        : alertAction
          ? { type: 'alert_mods' }
          : { type: 'log_only' },
    escalation: null,
    notifyChannelId: optionalString(alertAction?.metadata?.channelId) ?? null,
  };

  return {
    policySpecJson,
    compiledPolicyJson: {
      backend: 'native_discord_automod',
      nativeRule: {
        name: rule.name,
        eventType:
          rule.eventType === AutoModerationRuleEventType.MemberUpdate ? 'member_update' : 'message_send',
        triggerKind:
          rule.triggerType === AutoModerationRuleTriggerType.MentionSpam
            ? 'mention_spam'
            : rule.triggerType === AutoModerationRuleTriggerType.Spam
              ? 'spam'
              : rule.triggerType === AutoModerationRuleTriggerType.MemberProfile
                ? 'member_profile'
                : 'keyword',
        keywordFilter: triggerMetadata?.keywordFilter ? [...triggerMetadata.keywordFilter] : undefined,
        regexPatterns: triggerMetadata?.regexPatterns ? [...triggerMetadata.regexPatterns] : undefined,
        allowList: triggerMetadata?.allowList ? [...triggerMetadata.allowList] : undefined,
        mentionTotalLimit: triggerMetadata?.mentionTotalLimit ?? undefined,
        exemptChannelIds: [...rule.exemptChannels.keys()],
        exemptRoleIds: [...rule.exemptRoles.keys()],
        blockMessage: !!blockAction,
        alertChannelId: optionalString(alertAction?.metadata?.channelId) ?? null,
        customMessage: optionalString(blockAction?.metadata?.customMessage) ?? null,
        timeoutSeconds: timeoutAction?.metadata?.durationSeconds ?? null,
      },
      runtimeRule: null,
    },
    notifyChannelId: optionalString(alertAction?.metadata?.channelId) ?? null,
  };
}

function toDiscordAutoModOptions(
  policy: Pick<ModerationPolicyRecord, 'name' | 'mode' | 'notifyChannelId' | 'compiledPolicyJson'>,
): AutoModerationRuleCreateOptions | null {
  const nativeRule = policy.compiledPolicyJson.nativeRule;
  if (!nativeRule) {
    return null;
  }

  const actions: Array<AutoModerationRuleCreateOptions['actions'][number]> = [];
  if (nativeRule.blockMessage) {
    actions.push({
      type: AutoModerationActionType.BlockMessage,
      metadata: nativeRule.customMessage ? { customMessage: nativeRule.customMessage } : undefined,
    });
  }
  if (nativeRule.alertChannelId) {
    actions.push({
      type: AutoModerationActionType.SendAlertMessage,
      metadata: {
        channel: nativeRule.alertChannelId,
      },
    });
  }
  if (nativeRule.timeoutSeconds) {
    actions.push({
      type: AutoModerationActionType.Timeout,
      metadata: {
        durationSeconds: nativeRule.timeoutSeconds,
      },
    });
  }

  if (actions.length === 0) {
    return null;
  }

  const triggerMetadata =
    nativeRule.triggerKind === 'keyword'
      ? {
          keywordFilter: nativeRule.keywordFilter,
          regexPatterns: nativeRule.regexPatterns,
          allowList: nativeRule.allowList,
        }
      : nativeRule.triggerKind === 'mention_spam'
        ? {
            mentionTotalLimit: nativeRule.mentionTotalLimit,
          }
        : undefined;

  return {
    name: nativeRule.name || `${SAGE_AUTOMOD_PREFIX}${policy.name}`,
    enabled: policy.mode === 'enforce',
    eventType:
      nativeRule.eventType === 'member_update'
        ? AutoModerationRuleEventType.MemberUpdate
        : AutoModerationRuleEventType.MessageSend,
    triggerType:
      nativeRule.triggerKind === 'mention_spam'
        ? AutoModerationRuleTriggerType.MentionSpam
        : nativeRule.triggerKind === 'spam'
          ? AutoModerationRuleTriggerType.Spam
          : nativeRule.triggerKind === 'member_profile'
            ? AutoModerationRuleTriggerType.MemberProfile
            : AutoModerationRuleTriggerType.Keyword,
    triggerMetadata,
    actions,
    exemptChannels: nativeRule.exemptChannelIds ?? [],
    exemptRoles: nativeRule.exemptRoleIds ?? [],
    reason: 'Sage moderation policy sync',
  };
}

async function fetchGuild(guildId: string): Promise<Guild> {
  return client.guilds.fetch(guildId);
}

export function isSageManagedAutoModerationRule(rule: Pick<AutoModerationRule, 'name'>): boolean {
  return rule.name.startsWith(SAGE_AUTOMOD_PREFIX);
}

export async function syncSageModerationPolicyToDiscord(params: {
  policyId?: string;
  policy?: ModerationPolicyRecord;
}): Promise<{
  externalRuleId: string | null;
  lastSyncedAt: Date | null;
  lastConflictText: string | null;
}> {
  const policy = params.policy ?? (params.policyId ? await getModerationPolicyById(params.policyId) : null);
  if (!policy) {
    throw new Error('Moderation policy not found.');
  }

  if (policy.backend === 'sage_runtime' || policy.mode !== 'enforce') {
    if (policy.externalRuleId) {
      const guild = await fetchGuild(policy.guildId);
      const existing = await guild.autoModerationRules.fetch(policy.externalRuleId).catch(() => null);
      if (existing && isSageManagedAutoModerationRule(existing)) {
        await existing.delete('Sage moderation policy disabled or moved to runtime backend').catch(() => undefined);
      }
    }
    return {
      externalRuleId: null,
      lastSyncedAt: new Date(),
      lastConflictText: null,
    };
  }

  const options = toDiscordAutoModOptions(policy);
  if (!options) {
    return {
      externalRuleId: null,
      lastSyncedAt: new Date(),
      lastConflictText: 'Policy requires runtime enforcement because no safe native AutoMod action could be derived.',
    };
  }

  const guild = await fetchGuild(policy.guildId);
  const existing = policy.externalRuleId
    ? await guild.autoModerationRules.fetch(policy.externalRuleId).catch(() => null)
    : null;

  const syncedRule = existing
    ? await existing.edit(options).catch(async () => guild.autoModerationRules.create(options))
    : await guild.autoModerationRules.create(options);

  return {
    externalRuleId: syncedRule.id,
    lastSyncedAt: new Date(),
    lastConflictText: null,
  };
}

export async function importExternalDiscordAutoModerationRules(guildId: string): Promise<number> {
  const guild = await fetchGuild(guildId);
  const rules = await guild.autoModerationRules.fetch();
  const seenRuleIds: string[] = [];

  for (const rule of rules.values()) {
    if (isSageManagedAutoModerationRule(rule)) {
      continue;
    }
    const snapshot = buildExternalPolicySnapshot(rule);
    seenRuleIds.push(rule.id);
    await upsertExternalModerationPolicy({
      guildId,
      externalRuleId: rule.id,
      name: rule.name,
      descriptionText: 'Imported read-only from an existing Discord AutoMod rule.',
      family: snapshot.policySpecJson.family,
      backend: 'native_discord_automod',
      mode: rule.enabled ? 'enforce' : 'disabled',
      notifyChannelId: snapshot.notifyChannelId,
      policySpecJson: snapshot.policySpecJson,
      compiledPolicyJson: snapshot.compiledPolicyJson,
      lastSyncedAt: new Date(),
    });
  }

  await deleteMissingExternalModerationPolicies({
    guildId,
    externalRuleIds: seenRuleIds,
  });

  return seenRuleIds.length;
}

export function readAutoModerationExecutionEvidence(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  return value;
}
