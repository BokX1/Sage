export type ModerationPolicyMode = 'dry_run' | 'enforce' | 'disabled';
export type ModerationPolicyBackend = 'native_discord_automod' | 'sage_runtime' | 'hybrid';
export type ModerationPolicyOwnership = 'sage_managed' | 'external_discord';
export type ModerationPolicyFamily =
  | 'content_filter'
  | 'spam_filter'
  | 'member_safety'
  | 'attachment_policy';

export type ModerationPolicyAction =
  | 'log_only'
  | 'alert_mods'
  | 'delete_or_block_message'
  | 'timeout_member'
  | 'open_review_case';

export type ContentTriggerKind =
  | 'keyword_filter'
  | 'regex_filter'
  | 'blocked_domains'
  | 'invite_links'
  | 'mention_spam'
  | 'generic_spam';

export type RuntimeMessageTriggerKind =
  | 'burst_spam'
  | 'duplicate_messages'
  | 'caps_abuse'
  | 'attachment_policy';

export type MemberTriggerKind =
  | 'account_age_gate'
  | 'username_filter'
  | 'join_velocity';

export type ModerationTriggerKind =
  | ContentTriggerKind
  | RuntimeMessageTriggerKind
  | MemberTriggerKind;

export interface ModerationActionSpec {
  type: ModerationPolicyAction;
  timeoutMinutes?: number;
}

export interface ModerationEscalationSpec {
  threshold: number;
  windowMinutes: number;
  action: ModerationActionSpec;
}

export interface KeywordFilterTrigger {
  kind: 'keyword_filter';
  keywords: string[];
  allowList?: string[];
  exemptChannelIds?: string[];
  exemptRoleIds?: string[];
}

export interface RegexFilterTrigger {
  kind: 'regex_filter';
  patterns: string[];
  allowList?: string[];
  exemptChannelIds?: string[];
  exemptRoleIds?: string[];
}

export interface BlockedDomainsTrigger {
  kind: 'blocked_domains';
  domains: string[];
  exemptChannelIds?: string[];
  exemptRoleIds?: string[];
}

export interface InviteLinksTrigger {
  kind: 'invite_links';
  allowInternalInvites?: boolean;
  exemptChannelIds?: string[];
  exemptRoleIds?: string[];
}

export interface MentionSpamTrigger {
  kind: 'mention_spam';
  mentionTotalLimit: number;
  exemptChannelIds?: string[];
  exemptRoleIds?: string[];
}

export interface GenericSpamTrigger {
  kind: 'generic_spam';
  exemptChannelIds?: string[];
  exemptRoleIds?: string[];
}

export interface BurstSpamTrigger {
  kind: 'burst_spam';
  maxMessages: number;
  windowSeconds: number;
  exemptChannelIds?: string[];
  exemptRoleIds?: string[];
}

export interface DuplicateMessagesTrigger {
  kind: 'duplicate_messages';
  maxDuplicates: number;
  windowSeconds: number;
  exemptChannelIds?: string[];
  exemptRoleIds?: string[];
}

export interface CapsAbuseTrigger {
  kind: 'caps_abuse';
  minLength: number;
  uppercaseRatio: number;
  exemptChannelIds?: string[];
  exemptRoleIds?: string[];
}

export interface AttachmentPolicyTrigger {
  kind: 'attachment_policy';
  blockedExtensions?: string[];
  blockedContentTypes?: string[];
  maxBytes?: number;
  exemptChannelIds?: string[];
  exemptRoleIds?: string[];
}

export interface AccountAgeGateTrigger {
  kind: 'account_age_gate';
  minAccountAgeMinutes: number;
}

export interface UsernameFilterTrigger {
  kind: 'username_filter';
  keywords?: string[];
  patterns?: string[];
}

export interface JoinVelocityTrigger {
  kind: 'join_velocity';
  maxJoins: number;
  windowSeconds: number;
}

export type ModerationTriggerSpec =
  | KeywordFilterTrigger
  | RegexFilterTrigger
  | BlockedDomainsTrigger
  | InviteLinksTrigger
  | MentionSpamTrigger
  | GenericSpamTrigger
  | BurstSpamTrigger
  | DuplicateMessagesTrigger
  | CapsAbuseTrigger
  | AttachmentPolicyTrigger
  | AccountAgeGateTrigger
  | UsernameFilterTrigger
  | JoinVelocityTrigger;

export interface ModerationPolicySpec {
  family: ModerationPolicyFamily;
  trigger: ModerationTriggerSpec;
  action: ModerationActionSpec;
  escalation?: ModerationEscalationSpec | null;
  notifyChannelId?: string | null;
}

export interface CompiledModerationPolicy {
  backend: ModerationPolicyBackend;
  nativeRule:
    | {
        name: string;
        eventType: 'message_send' | 'member_update';
        triggerKind: 'keyword' | 'keyword_preset' | 'mention_spam' | 'spam' | 'member_profile';
        keywordFilter?: string[];
        regexPatterns?: string[];
        allowList?: string[];
        presets?: Array<'profanity' | 'sexual_content' | 'slurs'>;
        mentionTotalLimit?: number;
        exemptChannelIds?: string[];
        exemptRoleIds?: string[];
        blockMessage?: boolean;
        alertChannelId?: string | null;
        customMessage?: string | null;
        timeoutSeconds?: number | null;
      }
    | null;
  runtimeRule:
    | {
        kind: ModerationTriggerKind;
        config: Record<string, unknown>;
      }
    | null;
}

export interface ModerationPolicyRecord {
  id: string;
  guildId: string;
  name: string;
  descriptionText: string | null;
  family: ModerationPolicyFamily;
  backend: ModerationPolicyBackend;
  ownership: ModerationPolicyOwnership;
  mode: ModerationPolicyMode;
  version: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  externalRuleId: string | null;
  notifyChannelId: string | null;
  policySpecJson: ModerationPolicySpec;
  compiledPolicyJson: CompiledModerationPolicy;
  lastSyncedAt: Date | null;
  lastConflictText: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ModerationCaseSource =
  | 'runtime_policy'
  | 'native_automod'
  | 'manual_moderation'
  | 'review_escalation'
  | 'join_guard';

export type ModerationCaseStatus =
  | 'logged'
  | 'alerted'
  | 'executed'
  | 'dry_run'
  | 'open_review'
  | 'failed'
  | 'noop';

export type ModerationCaseLifecycleStatus =
  | 'open'
  | 'acknowledged'
  | 'resolved'
  | 'voided';

export interface ModerationCaseRecord {
  id: string;
  guildId: string;
  policyId: string | null;
  source: ModerationCaseSource;
  status: ModerationCaseStatus;
  lifecycleStatus: ModerationCaseLifecycleStatus;
  action: string;
  targetUserId: string | null;
  sourceMessageId: string | null;
  channelId: string | null;
  reviewChannelId: string | null;
  createdByUserId: string | null;
  acknowledgedByUserId: string | null;
  acknowledgedAt: Date | null;
  executedByUserId: string | null;
  resolutionReasonText: string | null;
  evidenceJson: Record<string, unknown> | null;
  metadataJson: Record<string, unknown> | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModerationCaseNoteRecord {
  id: string;
  caseId: string;
  guildId: string;
  createdByUserId: string;
  noteText: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModerationRuntimeDiagnostic {
  ready: boolean;
  requiredGatewayIntents: string[];
  missingGatewayIntents: string[];
  declaredGatewayIntents: string[];
  totalPolicies: number;
  enforcePolicies: number;
  dryRunPolicies: number;
  externalNativePolicies: number;
}
