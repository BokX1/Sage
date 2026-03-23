import type {
  CompiledModerationPolicy,
  ModerationPolicyAction,
  ModerationPolicyBackend,
  ModerationPolicySpec,
  ModerationTriggerKind,
} from './types';

function normalizeRuleName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 100);
}

function timeoutSecondsForAction(action: ModerationPolicySpec['action']): number | null {
  if (action.type !== 'timeout_member') return null;
  return Math.max(60, Math.min(action.timeoutMinutes ?? 10, 40_320) * 60);
}

function canCompileToNative(kind: ModerationTriggerKind): boolean {
  return (
    kind === 'keyword_filter' ||
    kind === 'regex_filter' ||
    kind === 'blocked_domains' ||
    kind === 'invite_links' ||
    kind === 'mention_spam' ||
    kind === 'generic_spam'
  );
}

function nativeCompatibleAction(action: ModerationPolicyAction): boolean {
  return (
    action === 'log_only' ||
    action === 'alert_mods' ||
    action === 'delete_or_block_message' ||
    action === 'timeout_member'
  );
}

function buildAlertActionChannelId(spec: ModerationPolicySpec): string | null {
  return spec.notifyChannelId?.trim() || null;
}

export function compileModerationPolicy(params: {
  name: string;
  spec: ModerationPolicySpec;
  mode: 'dry_run' | 'enforce' | 'disabled';
}): CompiledModerationPolicy {
  const { spec } = params;
  const timeoutSeconds = timeoutSecondsForAction(spec.action);
  const nativeEligible = canCompileToNative(spec.trigger.kind) && nativeCompatibleAction(spec.action.type);
  const runtimeEligible =
    params.mode !== 'enforce' ||
    !nativeEligible ||
    spec.action.type === 'open_review_case';

  let backend: ModerationPolicyBackend;
  if (nativeEligible && runtimeEligible && spec.action.type !== 'delete_or_block_message') {
    backend = 'hybrid';
  } else if (nativeEligible) {
    backend = 'native_discord_automod';
  } else {
    backend = 'sage_runtime';
  }

  const compiled: CompiledModerationPolicy = {
    backend,
    nativeRule: null,
    runtimeRule: null,
  };

  if (nativeEligible) {
    switch (spec.trigger.kind) {
      case 'keyword_filter':
        compiled.nativeRule = {
          name: `[Sage] ${normalizeRuleName(params.name)}`,
          eventType: 'message_send',
          triggerKind: 'keyword',
          keywordFilter: spec.trigger.keywords,
          allowList: spec.trigger.allowList ?? [],
          exemptChannelIds: spec.trigger.exemptChannelIds ?? [],
          exemptRoleIds: spec.trigger.exemptRoleIds ?? [],
          blockMessage: spec.action.type === 'delete_or_block_message' || spec.action.type === 'timeout_member',
          alertChannelId: buildAlertActionChannelId(spec),
          customMessage: null,
          timeoutSeconds,
        };
        break;
      case 'regex_filter':
        compiled.nativeRule = {
          name: `[Sage] ${normalizeRuleName(params.name)}`,
          eventType: 'message_send',
          triggerKind: 'keyword',
          regexPatterns: spec.trigger.patterns,
          allowList: spec.trigger.allowList ?? [],
          exemptChannelIds: spec.trigger.exemptChannelIds ?? [],
          exemptRoleIds: spec.trigger.exemptRoleIds ?? [],
          blockMessage: spec.action.type === 'delete_or_block_message' || spec.action.type === 'timeout_member',
          alertChannelId: buildAlertActionChannelId(spec),
          customMessage: null,
          timeoutSeconds,
        };
        break;
      case 'blocked_domains':
        compiled.nativeRule = {
          name: `[Sage] ${normalizeRuleName(params.name)}`,
          eventType: 'message_send',
          triggerKind: 'keyword',
          regexPatterns: spec.trigger.domains.map((domain) => `(?:https?:\\/\\/)?(?:[\\w-]+\\.)*${escapeRegex(domain)}\\b`),
          exemptChannelIds: spec.trigger.exemptChannelIds ?? [],
          exemptRoleIds: spec.trigger.exemptRoleIds ?? [],
          blockMessage: spec.action.type === 'delete_or_block_message' || spec.action.type === 'timeout_member',
          alertChannelId: buildAlertActionChannelId(spec),
          customMessage: null,
          timeoutSeconds,
        };
        break;
      case 'invite_links':
        compiled.nativeRule = {
          name: `[Sage] ${normalizeRuleName(params.name)}`,
          eventType: 'message_send',
          triggerKind: 'keyword',
          regexPatterns: spec.trigger.allowInternalInvites
            ? ['discord(?:app)?\\.com\\/invite\\/.+']
            : ['(?:discord\\.gg|discord(?:app)?\\.com\\/invite)\\/.+'],
          exemptChannelIds: spec.trigger.exemptChannelIds ?? [],
          exemptRoleIds: spec.trigger.exemptRoleIds ?? [],
          blockMessage: spec.action.type === 'delete_or_block_message' || spec.action.type === 'timeout_member',
          alertChannelId: buildAlertActionChannelId(spec),
          customMessage: null,
          timeoutSeconds,
        };
        break;
      case 'mention_spam':
        compiled.nativeRule = {
          name: `[Sage] ${normalizeRuleName(params.name)}`,
          eventType: 'message_send',
          triggerKind: 'mention_spam',
          mentionTotalLimit: spec.trigger.mentionTotalLimit,
          exemptChannelIds: spec.trigger.exemptChannelIds ?? [],
          exemptRoleIds: spec.trigger.exemptRoleIds ?? [],
          blockMessage: spec.action.type === 'delete_or_block_message' || spec.action.type === 'timeout_member',
          alertChannelId: buildAlertActionChannelId(spec),
          customMessage: null,
          timeoutSeconds,
        };
        break;
      case 'generic_spam':
        compiled.nativeRule = {
          name: `[Sage] ${normalizeRuleName(params.name)}`,
          eventType: 'message_send',
          triggerKind: 'spam',
          blockMessage: spec.action.type === 'delete_or_block_message' || spec.action.type === 'timeout_member',
          alertChannelId: buildAlertActionChannelId(spec),
          customMessage: null,
          timeoutSeconds,
        };
        break;
      default:
        break;
    }
  }

  if (runtimeEligible) {
    compiled.runtimeRule = {
      kind: spec.trigger.kind,
      config: { ...spec.trigger },
    };
  }

  return compiled;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
