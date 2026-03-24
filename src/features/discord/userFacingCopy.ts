export function buildInteractionFailureText(): string {
  return 'I could not handle that action, so please try it again.';
}

export function buildMessageFailureText(): string {
  return 'I could not finish that reply, so please send it again.';
}

export function buildExpiredInteractionText(kind: 'button' | 'form'): string {
  const subject = kind === 'form' ? 'form' : 'button';
  return `That Sage ${subject} expired, so please ask me for a new one.`;
}

export function buildConsumedInteractionText(kind: 'button' | 'form'): string {
  const subject = kind === 'form' ? 'form' : 'button';
  return `That Sage ${subject} was already used, so please ask me for a new one if you still need it.`;
}

export function buildRetryOwnerMismatchText(): string {
  return 'I can only retry this for the person who started it.';
}

export function buildRetryChannelMismatchText(channelId: string): string {
  return `I can only retry this in <#${channelId}>.`;
}

export function buildRetryButtonLabel(): string {
  return 'Retry';
}

export function buildApprovalQueuedHandoffText(params?: {
  reviewChannelId?: string | null;
  sourceChannelId?: string | null;
}): string {
  const reviewChannelId = params?.reviewChannelId?.trim();
  const sourceChannelId = params?.sourceChannelId?.trim();
  if (reviewChannelId && reviewChannelId !== sourceChannelId) {
    return `I queued that for review in <#${reviewChannelId}>.`;
  }

  return 'I queued that for review.';
}

export function buildMissingHostedGuildActivationFallbackText(): string {
  return "I'm not set up in this server yet, so please ask a server admin to activate me.";
}

export function buildMissingSelfHostedGuildApiKeyText(): string {
  return "I'm not set up to chat in this server yet, so please ask the bot operator to run `npm run auth:codex:login` or add the AI provider key.";
}

export function buildMissingHostApiKeyText(): string {
  return "I'm not set up to chat yet, so please ask the bot operator to run `npm run auth:codex:login` or add the AI provider key.";
}

export function buildApprovalGuildOnlyText(): string {
  return 'I can only handle approvals inside a server.';
}

export function buildApprovalAdminOnlyText(): string {
  return 'I need a server admin to do that.';
}

export function buildApprovalActionNotFoundText(): string {
  return "I can't find that review anymore.";
}

export function buildApprovalWrongGuildText(): string {
  return 'That review belongs to a different server.';
}

export function buildApprovalAlreadyResolvedText(status: string): string {
  const normalizedStatus = status.trim().replace(/_/g, ' ') || 'resolved';
  return `I already marked that review as ${normalizedStatus}.`;
}

export function buildApprovalReasonRequiredText(): string {
  return 'Please add a reason before rejecting that.';
}

export function buildApprovalFollowUpPostFailureText(): string {
  return "I rejected that, but I couldn't post the follow-up message.";
}

export function buildModerationApprovalPermissionsUnknownText(): string {
  return "I couldn't check the approval permissions for that action.";
}

export function buildModerationApprovalPermissionMissingText(permissionLabel: string): string {
  return `I need ${permissionLabel} to approve that.`;
}

export function buildModerationApprovalChannelPermissionsUnknownText(): string {
  return "I couldn't check your permissions in that channel.";
}

export function buildModerationApprovalChannelUnavailableText(): string {
  return "I couldn't check that because the channel is unavailable.";
}

export function buildModerationApprovalChannelPermissionMissingText(params: {
  channelId: string;
  permissionLabel: string;
}): string {
  return `I need ${params.permissionLabel} in <#${params.channelId}> to approve that.`;
}

export function buildServerKeyGuildOnlyText(): string {
  return 'I can only set that up inside a server.';
}

export function buildServerKeyManageAdminOnlyText(): string {
  return 'I need a server admin to manage the server key.';
}

export function buildServerKeySetAdminOnlyText(): string {
  return 'I need a server admin to set the server key.';
}

export function buildGuildContextRequiredText(): string {
  return 'I need the server context to do that.';
}

export function buildServerKeyInvalidFormatText(): string {
  return "That key doesn't look right, so please copy it again and make sure it starts with `sk_`.";
}
