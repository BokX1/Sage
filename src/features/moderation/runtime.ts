import {
  GatewayIntentBits,
  Message,
  GuildMember,
  type AutoModerationActionExecution,
} from 'discord.js';

import { client } from '../../platform/discord/client';
import { logger } from '../../platform/logging/logger';
import { executeAutonomousModerationAction } from '../admin/adminActionService';
import type { PreparedModerationAction } from '../admin/discordModeration';
import { compileModerationPolicy } from './compiler';
import {
  createModerationCase,
  getModerationPolicyById,
  getModerationPolicyByGuildName,
  listModerationCasesByGuild,
  listModerationPoliciesByGuild,
  markModerationCaseResolved,
  upsertModerationPolicy,
} from './moderationPolicyRepo';
import {
  importExternalDiscordAutoModerationRules,
  syncSageModerationPolicyToDiscord,
} from './automodSync';
import type {
  ModerationActionSpec,
  ModerationCaseRecord,
  ModerationPolicyMode,
  ModerationPolicyRecord,
  ModerationPolicySpec,
  ModerationRuntimeDiagnostic,
  ModerationTriggerSpec,
} from './types';

const POLICY_CACHE_TTL_MS = 15_000;
const BURST_WINDOW_CACHE = new Map<string, number[]>();
const DUPLICATE_WINDOW_CACHE = new Map<string, Array<{ text: string; ts: number }>>();
const JOIN_VELOCITY_CACHE = new Map<string, number[]>();
const moderationPolicyCache = new Map<string, { expiresAt: number; policies: ModerationPolicyRecord[] }>();
let lastDiagnosticSnapshot: ModerationRuntimeDiagnostic | null = null;

function optionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function toExcerpt(value: string, maxChars = 300): string {
  const trimmed = value.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, Math.max(1, maxChars - 1))}…`;
}

function readCurrentIntentNames(): string[] {
  const bitfield = client.options.intents;
  const bits = typeof bitfield === 'number' ? bitfield : Number(bitfield?.bitfield ?? bitfield ?? 0);
  return Object.entries(GatewayIntentBits)
    .filter(([, flag]) => typeof flag === 'number' && (bits & flag) === flag)
    .map(([name]) => name);
}

function hasRoleExemption(member: GuildMember | null, roleIds: string[] | undefined): boolean {
  if (!member || !roleIds?.length) {
    return false;
  }
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

function isMessageExempt(policy: ModerationPolicyRecord, message: Message): boolean {
  const trigger = policy.policySpecJson.trigger;
  if ('exemptChannelIds' in trigger && trigger.exemptChannelIds?.includes(message.channelId)) {
    return true;
  }
  if ('exemptRoleIds' in trigger && hasRoleExemption(message.member, trigger.exemptRoleIds)) {
    return true;
  }
  return false;
}

function pruneNumberWindow(cache: Map<string, number[]>, key: string, windowMs: number, now: number): number[] {
  const existing = cache.get(key) ?? [];
  const kept = existing.filter((ts) => now - ts <= windowMs);
  cache.set(key, kept);
  return kept;
}

function matchMessageTrigger(trigger: ModerationTriggerSpec, message: Message): {
  matched: boolean;
  detail?: Record<string, unknown>;
} {
  const content = message.content ?? '';
  const normalized = normalizeText(content);
  switch (trigger.kind) {
    case 'keyword_filter': {
      const matchedKeyword = trigger.keywords.find((keyword) => normalized.includes(keyword.toLowerCase()));
      const allowHit = (trigger.allowList ?? []).some((keyword) => normalized.includes(keyword.toLowerCase()));
      return matchedKeyword && !allowHit
        ? { matched: true, detail: { matchedKeyword } }
        : { matched: false };
    }
    case 'regex_filter': {
      for (const pattern of trigger.patterns) {
        try {
          const regex = new RegExp(pattern, 'iu');
          const match = regex.exec(content);
          if (match) {
            return { matched: true, detail: { matchedPattern: pattern, matchedContent: match[0] } };
          }
        } catch {
          continue;
        }
      }
      return { matched: false };
    }
    case 'blocked_domains': {
      for (const domain of trigger.domains) {
        const normalizedDomain = domain.trim().replace(/^\*\./, '').toLowerCase();
        if (normalized.includes(normalizedDomain)) {
          return { matched: true, detail: { matchedDomain: normalizedDomain } };
        }
      }
      return { matched: false };
    }
    case 'invite_links': {
      const inviteRegex = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/iu;
      const match = inviteRegex.exec(content);
      return match ? { matched: true, detail: { matchedContent: match[0] } } : { matched: false };
    }
    case 'mention_spam': {
      const mentionCount = message.mentions.users.size + message.mentions.roles.size;
      return mentionCount >= trigger.mentionTotalLimit
        ? { matched: true, detail: { mentionCount } }
        : { matched: false };
    }
    case 'generic_spam':
      return { matched: false };
    case 'burst_spam': {
      const key = `${message.guildId ?? 'dm'}:${message.channelId}:${message.author.id}`;
      const now = message.createdTimestamp || Date.now();
      const history = pruneNumberWindow(BURST_WINDOW_CACHE, key, trigger.windowSeconds * 1000, now);
      history.push(now);
      BURST_WINDOW_CACHE.set(key, history);
      return history.length >= trigger.maxMessages
        ? { matched: true, detail: { messageCount: history.length, windowSeconds: trigger.windowSeconds } }
        : { matched: false };
    }
    case 'duplicate_messages': {
      const key = `${message.guildId ?? 'dm'}:${message.channelId}:${message.author.id}`;
      const now = message.createdTimestamp || Date.now();
      const existing = (DUPLICATE_WINDOW_CACHE.get(key) ?? []).filter((entry) => now - entry.ts <= trigger.windowSeconds * 1000);
      existing.push({ text: normalized, ts: now });
      DUPLICATE_WINDOW_CACHE.set(key, existing);
      const duplicateCount = existing.filter((entry) => entry.text === normalized).length;
      return duplicateCount >= trigger.maxDuplicates
        ? { matched: true, detail: { duplicateCount, normalizedText: normalized } }
        : { matched: false };
    }
    case 'caps_abuse': {
      const letters = content.replace(/[^A-Za-z]/g, '');
      if (letters.length < trigger.minLength) {
        return { matched: false };
      }
      const uppercaseLetters = letters.replace(/[^A-Z]/g, '').length;
      const ratio = uppercaseLetters / Math.max(1, letters.length);
      return ratio >= trigger.uppercaseRatio
        ? { matched: true, detail: { uppercaseRatio: Number(ratio.toFixed(3)) } }
        : { matched: false };
    }
    case 'attachment_policy': {
      for (const attachment of message.attachments.values()) {
        const extension = attachment.name?.split('.').pop()?.toLowerCase() ?? null;
        const contentType = attachment.contentType?.toLowerCase() ?? null;
        if (trigger.maxBytes && typeof attachment.size === 'number' && attachment.size > trigger.maxBytes) {
          return { matched: true, detail: { matchedAttachment: attachment.name, reason: 'max_bytes' } };
        }
        if (extension && trigger.blockedExtensions?.map((value) => value.toLowerCase()).includes(extension)) {
          return { matched: true, detail: { matchedAttachment: attachment.name, reason: 'blocked_extension' } };
        }
        if (contentType && trigger.blockedContentTypes?.map((value) => value.toLowerCase()).includes(contentType)) {
          return { matched: true, detail: { matchedAttachment: attachment.name, reason: 'blocked_content_type' } };
        }
      }
      return { matched: false };
    }
    default:
      return { matched: false };
  }
}

function matchMemberTrigger(trigger: ModerationTriggerSpec, member: GuildMember): {
  matched: boolean;
  detail?: Record<string, unknown>;
} {
  switch (trigger.kind) {
    case 'account_age_gate': {
      const ageMinutes = Math.floor((Date.now() - member.user.createdTimestamp) / 60_000);
      return ageMinutes < trigger.minAccountAgeMinutes
        ? { matched: true, detail: { ageMinutes, minimumMinutes: trigger.minAccountAgeMinutes } }
        : { matched: false };
    }
    case 'username_filter': {
      const candidates = [
        member.user.username,
        member.user.globalName ?? '',
        member.displayName ?? '',
      ]
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      const lowered = candidates.map((value) => value.toLowerCase());
      const matchedKeyword = (trigger.keywords ?? []).find((keyword) =>
        lowered.some((candidate) => candidate.includes(keyword.toLowerCase())),
      );
      if (matchedKeyword) {
        return { matched: true, detail: { matchedKeyword } };
      }
      for (const pattern of trigger.patterns ?? []) {
        try {
          const regex = new RegExp(pattern, 'iu');
          const match = candidates.find((candidate) => regex.test(candidate));
          if (match) {
            return { matched: true, detail: { matchedPattern: pattern, matchedContent: match } };
          }
        } catch {
          continue;
        }
      }
      return { matched: false };
    }
    case 'join_velocity': {
      const key = member.guild.id;
      const now = Date.now();
      const history = pruneNumberWindow(JOIN_VELOCITY_CACHE, key, trigger.windowSeconds * 1000, now);
      history.push(now);
      JOIN_VELOCITY_CACHE.set(key, history);
      return history.length >= trigger.maxJoins
        ? { matched: true, detail: { joinCount: history.length, windowSeconds: trigger.windowSeconds } }
        : { matched: false };
    }
    default:
      return { matched: false };
  }
}

async function sendModerationAlert(params: {
  guildId: string;
  channelId: string | null;
  content: string;
}): Promise<void> {
  if (!params.channelId) {
    return;
  }
  const channel = await client.channels.fetch(params.channelId).catch(() => null);
  if (!channel || channel.isDMBased() || typeof (channel as { send?: unknown }).send !== 'function') {
    return;
  }
  await ((channel as unknown as { send: (payload: { content: string; allowedMentions: { parse: [] } }) => Promise<unknown> }).send({
    content: params.content,
    allowedMentions: { parse: [] },
  })).catch(() => undefined);
}

async function validateGuildNotificationChannel(params: {
  guildId: string;
  channelId: string | null | undefined;
}): Promise<void> {
  const channelId = optionalString(params.channelId);
  if (!channelId) {
    return;
  }
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.isDMBased?.() || !('guildId' in channel) || channel.guildId !== params.guildId) {
    throw new Error('notifyChannelId must point to a text channel in the active guild.');
  }
  if (typeof channel.isTextBased === 'function' && !channel.isTextBased()) {
    throw new Error('notifyChannelId must point to a text-capable channel in the active guild.');
  }
}

function buildCaseEvidenceForMessage(policy: ModerationPolicyRecord, message: Message, detail?: Record<string, unknown>) {
  return {
    policyName: policy.name,
    policyVersion: policy.version,
    authorId: message.author.id,
    authorTag: message.author.username,
    channelId: message.channelId,
    messageId: message.id,
    excerpt: toExcerpt(message.content ?? ''),
    attachmentCount: message.attachments.size,
    detail: detail ?? null,
  };
}

function toPreparedModerationAction(params: {
  policy: ModerationPolicyRecord;
  action: ModerationActionSpec;
  message?: Message;
  member?: GuildMember;
}): PreparedModerationAction | null {
  switch (params.action.type) {
    case 'delete_or_block_message':
      if (!params.message) return null;
      return {
        action: 'delete_message',
        channelId: params.message.channelId,
        messageId: params.message.id,
        reason: `Sage policy "${params.policy.name}" matched.`,
      };
    case 'timeout_member': {
      const userId = params.member?.id ?? params.message?.author.id;
      if (!userId) return null;
      return {
        action: 'timeout_member',
        userId,
        durationMinutes: Math.max(1, params.action.timeoutMinutes ?? 10),
        reason: `Sage policy "${params.policy.name}" matched.`,
      };
    }
    default:
      return null;
  }
}

async function listRuntimePolicies(guildId: string): Promise<ModerationPolicyRecord[]> {
  const now = Date.now();
  const cached = moderationPolicyCache.get(guildId);
  if (cached && cached.expiresAt > now) {
    return cached.policies;
  }
  const rows = await listModerationPoliciesByGuild(guildId);
  const policies = rows.filter((policy) => policy.ownership === 'sage_managed' && policy.mode !== 'disabled');
  moderationPolicyCache.set(guildId, {
    expiresAt: now + POLICY_CACHE_TTL_MS,
    policies,
  });
  return policies;
}

function invalidatePolicyCache(guildId: string): void {
  moderationPolicyCache.delete(guildId);
}

async function maybeApplyEscalation(params: {
  policy: ModerationPolicyRecord;
  targetUserId: string | null;
  fallbackAction: ModerationActionSpec;
}): Promise<ModerationActionSpec> {
  const escalation = params.policy.policySpecJson.escalation;
  if (!escalation || !params.targetUserId) {
    return params.fallbackAction;
  }
  const recentCases = await listModerationCasesByGuild({
    guildId: params.policy.guildId,
    policyId: params.policy.id,
    limit: 100,
  });
  const windowMs = escalation.windowMinutes * 60_000;
  const now = Date.now();
  const hits = recentCases.filter((entry) =>
    entry.targetUserId === params.targetUserId &&
    now - entry.createdAt.getTime() <= windowMs &&
    entry.status !== 'dry_run' &&
    entry.status !== 'failed',
  ).length;
  return hits + 1 >= escalation.threshold ? escalation.action : params.fallbackAction;
}

async function handleMatchedPolicy(params: {
  policy: ModerationPolicyRecord;
  source: ModerationCaseRecord['source'];
  message?: Message;
  member?: GuildMember;
  detail?: Record<string, unknown>;
}): Promise<{
  matched: true;
  suppressInvocation: boolean;
  caseRecord: ModerationCaseRecord;
}> {
  const targetUserId = params.member?.id ?? params.message?.author.id ?? null;
  const effectiveAction = await maybeApplyEscalation({
    policy: params.policy,
    targetUserId,
    fallbackAction: params.policy.policySpecJson.action,
  });
  const evidenceJson = params.message
    ? buildCaseEvidenceForMessage(params.policy, params.message, params.detail)
    : {
        policyName: params.policy.name,
        policyVersion: params.policy.version,
        targetUserId,
        detail: params.detail ?? null,
      };

  if (params.policy.mode === 'dry_run') {
    const caseRecord = await createModerationCase({
      guildId: params.policy.guildId,
      policyId: params.policy.id,
      source: params.source,
      status: 'dry_run',
      action: effectiveAction.type,
      targetUserId,
      sourceMessageId: params.message?.id ?? null,
      channelId: params.message?.channelId ?? null,
      createdByUserId: targetUserId,
      evidenceJson,
      metadataJson: {
        mode: 'dry_run',
      },
    });
    return {
      matched: true,
      suppressInvocation: false,
      caseRecord,
    };
  }

  if (effectiveAction.type === 'log_only' || effectiveAction.type === 'alert_mods' || effectiveAction.type === 'open_review_case') {
    const caseRecord = await createModerationCase({
      guildId: params.policy.guildId,
      policyId: params.policy.id,
      source: params.source,
      status:
        effectiveAction.type === 'alert_mods'
          ? 'alerted'
          : effectiveAction.type === 'open_review_case'
            ? 'open_review'
            : 'logged',
      action: effectiveAction.type,
      targetUserId,
      sourceMessageId: params.message?.id ?? null,
      channelId: params.message?.channelId ?? null,
      reviewChannelId: params.policy.notifyChannelId ?? null,
      createdByUserId: targetUserId,
      evidenceJson,
      metadataJson: {
        mode: 'enforce',
      },
    });
    if (params.policy.notifyChannelId) {
      await sendModerationAlert({
        guildId: params.policy.guildId,
        channelId: params.policy.notifyChannelId,
        content: `Policy "${params.policy.name}" matched for <@${targetUserId ?? 'unknown'}>. Case: ${caseRecord.id}`,
      });
    }
    return {
      matched: true,
      suppressInvocation: effectiveAction.type !== 'log_only',
      caseRecord,
    };
  }

  const preparedAction = toPreparedModerationAction({
    policy: params.policy,
    action: effectiveAction,
    message: params.message,
    member: params.member,
  });
  if (!preparedAction) {
    const caseRecord = await createModerationCase({
      guildId: params.policy.guildId,
      policyId: params.policy.id,
      source: params.source,
      status: 'failed',
      action: effectiveAction.type,
      targetUserId,
      sourceMessageId: params.message?.id ?? null,
      channelId: params.message?.channelId ?? null,
      createdByUserId: targetUserId,
      evidenceJson,
      metadataJson: {
        reason: 'No executable moderation action could be derived.',
      },
    });
    return {
      matched: true,
      suppressInvocation: false,
      caseRecord,
    };
  }

  const caseRecord = await createModerationCase({
    guildId: params.policy.guildId,
    policyId: params.policy.id,
    source: params.source,
    status: 'logged',
    action: preparedAction.action,
    targetUserId,
    sourceMessageId: params.message?.id ?? null,
    channelId: params.message?.channelId ?? null,
    reviewChannelId: params.policy.notifyChannelId ?? null,
    createdByUserId: targetUserId,
    evidenceJson,
    metadataJson: {
      preparedAction,
    },
  });

  try {
    await executeAutonomousModerationAction({
      action: preparedAction,
      guildId: params.policy.guildId,
      channelId: params.message?.channelId ?? params.member?.guild.systemChannelId ?? params.member?.guild.id ?? '',
      actionId: `sage_policy:${params.policy.id}:${caseRecord.id}`,
      requestedBy: targetUserId ?? 'SYSTEM',
    });
    const resolved = await markModerationCaseResolved({
      id: caseRecord.id,
      status: 'executed',
      executedByUserId: 'sage:auto',
      metadataJson: {
        preparedAction,
      },
    });
    if (params.policy.notifyChannelId) {
      await sendModerationAlert({
        guildId: params.policy.guildId,
        channelId: params.policy.notifyChannelId,
        content: `Policy "${params.policy.name}" enforced against <@${targetUserId ?? 'unknown'}>. Case: ${resolved.id}`,
      });
    }
    return {
      matched: true,
      suppressInvocation: true,
      caseRecord: resolved,
    };
  } catch (error) {
    const resolved = await markModerationCaseResolved({
      id: caseRecord.id,
      status: 'failed',
      executedByUserId: 'sage:auto',
      metadataJson: {
        preparedAction,
        errorText: error instanceof Error ? error.message : String(error),
      },
    });
    logger.warn(
      { error, policyId: params.policy.id, caseId: caseRecord.id },
      'Autonomous moderation action failed',
    );
    return {
      matched: true,
      suppressInvocation: false,
      caseRecord: resolved,
    };
  }
}

export async function upsertModerationPolicyForTool(params: {
  guildId: string;
  requestedByUserId: string;
  policyId?: string;
  name: string;
  descriptionText?: string | null;
  mode: ModerationPolicyMode;
  spec: ModerationPolicySpec;
}): Promise<Record<string, unknown>> {
  const existingPolicy = params.policyId ? await getModerationPolicyById(params.policyId) : null;
  if (params.policyId && (!existingPolicy || existingPolicy.guildId !== params.guildId)) {
    throw new Error('Moderation policy not found.');
  }

  await validateGuildNotificationChannel({
    guildId: params.guildId,
    channelId: params.spec.notifyChannelId,
  });

  const compiledPolicyJson = compileModerationPolicy({
    name: params.name,
    spec: params.spec,
    mode: params.mode,
  });

  let policy = await upsertModerationPolicy({
    id: existingPolicy?.id,
    guildId: params.guildId,
    name: params.name,
    descriptionText: params.descriptionText ?? null,
    family: params.spec.family,
    backend: compiledPolicyJson.backend,
    ownership: 'sage_managed',
    mode: params.mode,
    createdByUserId: existingPolicy?.createdByUserId ?? params.requestedByUserId,
    updatedByUserId: params.requestedByUserId,
    externalRuleId: existingPolicy?.externalRuleId ?? null,
    notifyChannelId: params.spec.notifyChannelId ?? null,
    policySpecJson: params.spec,
    compiledPolicyJson,
    incrementVersion: true,
  });

  const syncResult = await syncSageModerationPolicyToDiscord({
    policyId: policy.id,
  });

  policy = await upsertModerationPolicy({
    id: policy.id,
    guildId: params.guildId,
    name: params.name,
    descriptionText: params.descriptionText ?? null,
    family: params.spec.family,
    backend: compiledPolicyJson.backend,
    ownership: 'sage_managed',
    mode: params.mode,
    createdByUserId: policy.createdByUserId ?? params.requestedByUserId,
    updatedByUserId: params.requestedByUserId,
    externalRuleId: syncResult.externalRuleId,
    notifyChannelId: params.spec.notifyChannelId ?? null,
    policySpecJson: params.spec,
    compiledPolicyJson,
    lastSyncedAt: syncResult.lastSyncedAt,
    lastConflictText: syncResult.lastConflictText,
    incrementVersion: false,
  });

  invalidatePolicyCache(params.guildId);

  return {
    ok: true,
    action: 'upsert_moderation_policy',
    policy: {
      id: policy.id,
      name: policy.name,
      family: policy.family,
      backend: policy.backend,
      mode: policy.mode,
      ownership: policy.ownership,
      version: policy.version,
      externalRuleId: policy.externalRuleId,
      lastSyncedAt: policy.lastSyncedAt?.toISOString() ?? null,
      lastConflictText: policy.lastConflictText,
    },
  };
}

export async function disableModerationPolicyForTool(params: {
  guildId: string;
  requestedByUserId: string;
  policyId?: string;
  name?: string;
}): Promise<Record<string, unknown>> {
  const policy =
    (params.policyId ? await getModerationPolicyById(params.policyId) : null) ??
    (params.name ? await getModerationPolicyByGuildName({ guildId: params.guildId, name: params.name }) : null);
  if (!policy || policy.guildId !== params.guildId) {
    throw new Error('Moderation policy not found.');
  }

  const syncResult = await syncSageModerationPolicyToDiscord({
    policy: {
      ...policy,
      mode: 'disabled',
    },
  });
  const updated = await upsertModerationPolicy({
    id: policy.id,
    guildId: policy.guildId,
    name: policy.name,
    descriptionText: policy.descriptionText,
    family: policy.family,
    backend: policy.backend,
    ownership: policy.ownership,
    mode: 'disabled',
    createdByUserId: policy.createdByUserId,
    updatedByUserId: params.requestedByUserId,
    externalRuleId: syncResult.externalRuleId,
    notifyChannelId: policy.notifyChannelId,
    policySpecJson: policy.policySpecJson,
    compiledPolicyJson: policy.compiledPolicyJson,
    lastSyncedAt: syncResult.lastSyncedAt,
    lastConflictText: syncResult.lastConflictText,
    incrementVersion: true,
  });
  invalidatePolicyCache(policy.guildId);
  return {
    ok: true,
    action: 'disable_moderation_policy',
    policyId: updated.id,
    name: updated.name,
    mode: updated.mode,
  };
}

export async function listModerationPoliciesForTool(params: {
  guildId: string;
  syncExternal?: boolean;
}): Promise<Record<string, unknown>> {
  if (params.syncExternal !== false) {
    await importExternalDiscordAutoModerationRules(params.guildId).catch((error) => {
      logger.warn({ error, guildId: params.guildId }, 'Failed to refresh external Discord AutoMod inventory');
    });
  }
  const policies = await listModerationPoliciesByGuild(params.guildId);
  return {
    ok: true,
    action: 'list_moderation_policies',
    guildId: params.guildId,
    items: policies.map((policy) => ({
      id: policy.id,
      name: policy.name,
      family: policy.family,
      backend: policy.backend,
      ownership: policy.ownership,
      mode: policy.mode,
      version: policy.version,
      notifyChannelId: policy.notifyChannelId,
      externalRuleId: policy.externalRuleId,
      lastSyncedAt: policy.lastSyncedAt?.toISOString() ?? null,
      lastConflictText: policy.lastConflictText,
      updatedAt: policy.updatedAt.toISOString(),
    })),
  };
}

export async function getModerationPolicyForTool(params: {
  guildId: string;
  policyId?: string;
  name?: string;
}): Promise<Record<string, unknown>> {
  const policy =
    (params.policyId ? await getModerationPolicyById(params.policyId) : null) ??
    (params.name ? await getModerationPolicyByGuildName({ guildId: params.guildId, name: params.name }) : null);
  if (!policy || policy.guildId !== params.guildId) {
    throw new Error('Moderation policy not found.');
  }
  return {
    ok: true,
    action: 'get_moderation_policy',
    guildId: params.guildId,
    policy,
  };
}

export async function listModerationCasesForTool(params: {
  guildId: string;
  limit?: number;
  policyId?: string;
}): Promise<Record<string, unknown>> {
  const cases = await listModerationCasesByGuild({
    guildId: params.guildId,
    policyId: params.policyId,
    limit: params.limit ?? 25,
  });
  return {
    ok: true,
    action: 'list_moderation_cases',
    guildId: params.guildId,
    items: cases.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      resolvedAt: entry.resolvedAt?.toISOString() ?? null,
    })),
  };
}

export async function evaluateMessageModeration(params: {
  message: Message;
  isEdit?: boolean;
}): Promise<{
  matched: boolean;
  suppressInvocation: boolean;
  caseId?: string;
}> {
  const guildId = params.message.guildId;
  if (!guildId || params.message.author.bot) {
    return { matched: false, suppressInvocation: false };
  }

  const policies = await listRuntimePolicies(guildId);
  for (const policy of policies) {
    if (!policy.compiledPolicyJson.runtimeRule || isMessageExempt(policy, params.message)) {
      continue;
    }
    const { matched, detail } = matchMessageTrigger(policy.policySpecJson.trigger, params.message);
    if (!matched) {
      continue;
    }
    const handled = await handleMatchedPolicy({
      policy,
      source: 'runtime_policy',
      message: params.message,
      detail: {
        ...detail,
        isEdit: params.isEdit === true,
      },
    });
    return {
      matched: true,
      suppressInvocation: handled.suppressInvocation,
      caseId: handled.caseRecord.id,
    };
  }

  return { matched: false, suppressInvocation: false };
}

export async function evaluateMemberJoinModeration(member: GuildMember): Promise<{
  matched: boolean;
  caseId?: string;
}> {
  const policies = await listRuntimePolicies(member.guild.id);
  for (const policy of policies) {
    const trigger = policy.policySpecJson.trigger;
    if (trigger.kind !== 'account_age_gate' && trigger.kind !== 'join_velocity' && trigger.kind !== 'username_filter') {
      continue;
    }
    const { matched, detail } = matchMemberTrigger(trigger, member);
    if (!matched) {
      continue;
    }
    const handled = await handleMatchedPolicy({
      policy,
      source: trigger.kind === 'join_velocity' ? 'join_guard' : 'runtime_policy',
      member,
      detail,
    });
    return {
      matched: true,
      caseId: handled.caseRecord.id,
    };
  }
  return { matched: false };
}

export async function evaluateMemberProfileModeration(member: GuildMember): Promise<{
  matched: boolean;
  caseId?: string;
}> {
  const policies = await listRuntimePolicies(member.guild.id);
  for (const policy of policies) {
    if (policy.policySpecJson.trigger.kind !== 'username_filter') {
      continue;
    }
    const { matched, detail } = matchMemberTrigger(policy.policySpecJson.trigger, member);
    if (!matched) {
      continue;
    }
    const handled = await handleMatchedPolicy({
      policy,
      source: 'runtime_policy',
      member,
      detail,
    });
    return {
      matched: true,
      caseId: handled.caseRecord.id,
    };
  }
  return { matched: false };
}

export async function recordNativeAutoModerationExecution(params: {
  execution: AutoModerationActionExecution;
}): Promise<void> {
  const guildId = params.execution.guild.id;
  await importExternalDiscordAutoModerationRules(guildId).catch(() => undefined);
  const policies = await listModerationPoliciesByGuild(guildId);
  const linkedPolicy = policies.find((policy) => policy.externalRuleId === params.execution.ruleId) ?? null;
  await createModerationCase({
    guildId,
    policyId: linkedPolicy?.id ?? null,
    source: 'native_automod',
    status: 'executed',
    action: String(params.execution.action.type),
    targetUserId: params.execution.userId,
    sourceMessageId: optionalString(params.execution.messageId) ?? null,
    channelId: optionalString(params.execution.channelId) ?? null,
    createdByUserId: params.execution.userId,
    executedByUserId: 'discord:automod',
    evidenceJson: {
      matchedKeyword: optionalString(params.execution.matchedKeyword) ?? null,
      matchedContent: optionalString(params.execution.matchedContent) ?? null,
      content: optionalString(params.execution.content) ?? null,
      ruleId: params.execution.ruleId,
      alertSystemMessageId: optionalString(params.execution.alertSystemMessageId) ?? null,
    },
  });
}

export async function getModerationRuntimeDiagnostics(): Promise<ModerationRuntimeDiagnostic> {
  const declaredGatewayIntents = readCurrentIntentNames();
  const requiredGatewayIntents = [
    'GuildMembers',
    'AutoModerationConfiguration',
    'AutoModerationExecution',
  ];
  const missingGatewayIntents = requiredGatewayIntents.filter((name) => !declaredGatewayIntents.includes(name));
  const allPolicies = await listModerationPoliciesByGuildFromCachelessAllGuilds().catch(() => []);
  const diagnostic: ModerationRuntimeDiagnostic = {
    ready: missingGatewayIntents.length === 0,
    requiredGatewayIntents,
    missingGatewayIntents,
    declaredGatewayIntents,
    totalPolicies: allPolicies.length,
    enforcePolicies: allPolicies.filter((policy) => policy.mode === 'enforce').length,
    dryRunPolicies: allPolicies.filter((policy) => policy.mode === 'dry_run').length,
    externalNativePolicies: allPolicies.filter((policy) => policy.ownership === 'external_discord').length,
  };
  lastDiagnosticSnapshot = diagnostic;
  return diagnostic;
}

async function listModerationPoliciesByGuildFromCachelessAllGuilds(): Promise<ModerationPolicyRecord[]> {
  const guildIds = client.guilds.cache.map((guild) => guild.id);
  if (guildIds.length === 0) {
    return [];
  }
  const result: ModerationPolicyRecord[] = [];
  for (const guildId of guildIds) {
    const policies = await listModerationPoliciesByGuild(guildId).catch(() => []);
    result.push(...policies);
  }
  return result;
}

export function getLastModerationRuntimeDiagnosticSnapshot(): ModerationRuntimeDiagnostic | null {
  return lastDiagnosticSnapshot;
}

export function __resetModerationRuntimeForTests(): void {
  moderationPolicyCache.clear();
  BURST_WINDOW_CACHE.clear();
  DUPLICATE_WINDOW_CACHE.clear();
  JOIN_VELOCITY_CACHE.clear();
  lastDiagnosticSnapshot = null;
}
