import { MessageFlags } from 'discord.js';
import {
  ButtonStyle as ApiButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIContainerComponent,
  type APIMessageTopLevelComponent,
  type APISeparatorComponent,
  SeparatorSpacingSize,
  type APITextDisplayComponent,
} from 'discord-api-types/payloads/v10';
import type { ApprovalReviewRequestRecord } from './approvalReviewRequestRepo';
import { readPreparedModerationEnvelope, type PreparedModerationEnvelope } from './discordModeration';

type InteractiveApiButtonStyle =
  | ApiButtonStyle.Primary
  | ApiButtonStyle.Secondary
  | ApiButtonStyle.Success
  | ApiButtonStyle.Danger;

type GovernanceRisk = 'low' | 'medium' | 'high' | 'critical';

type GovernanceSummary = {
  title: string;
  intent: string;
  target: string;
  impact: string;
  risk: GovernanceRisk;
  preview?: string;
};

export type GovernanceMessagePayload = {
  flags: MessageFlags;
  components: APIMessageTopLevelComponent[];
};

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(1, maxChars - 1))}…`;
}

function formatDiscordTimestamp(date: Date): string {
  const unixSeconds = Math.floor(date.getTime() / 1000);
  return `<t:${unixSeconds}:f> (<t:${unixSeconds}:R>)`;
}

function normalizeUnknownRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function statusLabel(action: ApprovalReviewRequestRecord, coalesced?: boolean): string {
  switch (action.status) {
    case 'pending':
      return coalesced ? 'Joined existing review' : 'Queued for review';
    case 'approved':
      return 'Approved';
    case 'executed':
      return 'Executed';
    case 'rejected':
      return 'Rejected';
    case 'failed':
      return 'Failed';
    case 'expired':
      return 'Expired';
  }
}

function accentColorForState(action: ApprovalReviewRequestRecord): number {
  switch (action.status) {
    case 'pending':
      return 0x5865f2;
    case 'approved':
      return 0x57f287;
    case 'executed':
      return 0x57f287;
    case 'rejected':
      return 0xed4245;
    case 'failed':
      return 0xed4245;
    case 'expired':
      return 0xfee75c;
  }
}

function sanitizeForDetailView(value: unknown, depth = 0): unknown {
  if (depth >= 6) return '[…]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncate(value, 240);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const preview = value.slice(0, 12).map((entry) => sanitizeForDetailView(entry, depth + 1));
    if (value.length > preview.length) {
      preview.push(`[…+${value.length - preview.length} more]`);
    }
    return preview;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    const keys = Object.keys(record).sort().slice(0, 24);
    for (const key of keys) {
      output[key] = sanitizeForDetailView(record[key], depth + 1);
    }
    return output;
  }
  return String(value);
}

function riskBadge(risk: GovernanceRisk): string {
  switch (risk) {
    case 'low':
      return 'Low risk';
    case 'medium':
      return 'Medium risk';
    case 'high':
      return 'High risk';
    case 'critical':
      return 'Critical risk';
  }
}

function buildModerationPreview(reason: string | null, envelope?: PreparedModerationEnvelope | null): string | undefined {
  const parts = [reason, envelope?.evidence.messageExcerpt ?? null]
    .filter((value): value is string => !!value && value.trim().length > 0)
    .map((value) => value.trim());
  if (parts.length === 0) {
    return undefined;
  }
  return truncate(parts.join('\n\n'), 420);
}

function describePreparedModerationTarget(envelope: PreparedModerationEnvelope | null | undefined): string | null {
  if (!envelope) return null;
  const action = envelope.canonicalAction;
  switch (action.action) {
    case 'delete_message':
    case 'clear_reactions':
      return envelope.evidence.messageUrl ?? `Message ${action.messageId}`;
    case 'remove_user_reaction':
      return `${envelope.evidence.messageUrl ?? `Message ${action.messageId}`} -> user <@${action.userId}>`;
    case 'timeout_member':
      return `<@${action.userId}> for ${action.durationMinutes} minute(s)`;
    case 'untimeout_member':
    case 'kick_member':
    case 'ban_member':
    case 'unban_member':
      return `<@${action.userId}>`;
    default:
      return null;
  }
}

function summarizeModerationAction(
  action: Record<string, unknown>,
  envelope?: PreparedModerationEnvelope | null,
): GovernanceSummary {
  const actionName = asString(action.action) ?? 'moderation_action';
  const reason = asString(action.reason);
  const preparedTarget = describePreparedModerationTarget(envelope);
  switch (actionName) {
    case 'delete_message':
      return {
        title: 'Moderation Review',
        intent: 'Delete a Discord message',
        target: preparedTarget ?? `Message ${asString(action.messageId) ?? 'unknown'}`,
        impact: 'Removes content from the server.',
        risk: 'high',
        preview: buildModerationPreview(reason, envelope),
      };
    case 'timeout_member':
      return {
        title: 'Moderation Review',
        intent: 'Timeout a member',
        target: preparedTarget ?? `<@${asString(action.userId) ?? 'unknown'}>`,
        impact: 'Restricts the member from participating temporarily.',
        risk: 'high',
        preview: buildModerationPreview(reason, envelope),
      };
    case 'untimeout_member':
      return {
        title: 'Moderation Review',
        intent: 'Remove a member timeout',
        target: preparedTarget ?? `<@${asString(action.userId) ?? 'unknown'}>`,
        impact: 'Restores a member’s ability to participate.',
        risk: 'medium',
        preview: buildModerationPreview(reason, envelope),
      };
    case 'kick_member':
      return {
        title: 'Moderation Review',
        intent: 'Kick a member',
        target: preparedTarget ?? `<@${asString(action.userId) ?? 'unknown'}>`,
        impact: 'Removes the member from the server.',
        risk: 'critical',
        preview: buildModerationPreview(reason, envelope),
      };
    case 'ban_member':
      return {
        title: 'Moderation Review',
        intent: 'Ban a member',
        target: preparedTarget ?? `<@${asString(action.userId) ?? 'unknown'}>`,
        impact: 'Removes the member and blocks re-entry.',
        risk: 'critical',
        preview: buildModerationPreview(reason, envelope),
      };
    case 'remove_user_reaction':
      return {
        title: 'Moderation Review',
        intent: 'Remove a user reaction',
        target: preparedTarget ?? `Message ${asString(action.messageId) ?? 'unknown'}`,
        impact: 'Removes a specific user reaction from a message.',
        risk: 'medium',
        preview: buildModerationPreview(reason, envelope),
      };
    case 'clear_reactions':
      return {
        title: 'Moderation Review',
        intent: 'Clear reactions from a message',
        target: preparedTarget ?? `Message ${asString(action.messageId) ?? 'unknown'}`,
        impact: 'Removes all reactions from the target message.',
        risk: 'high',
        preview: buildModerationPreview(reason, envelope),
      };
    case 'unban_member':
      return {
        title: 'Moderation Review',
        intent: 'Unban a member',
        target: preparedTarget ?? `<@${asString(action.userId) ?? 'unknown'}>`,
        impact: 'Allows the user to rejoin the server.',
        risk: 'medium',
        preview: buildModerationPreview(reason, envelope),
      };
    default:
      return {
        title: 'Moderation Review',
        intent: `Run moderation action: ${actionName}`,
        target: preparedTarget ?? 'Discord moderation target',
        impact: 'Applies a moderation action in the server.',
        risk: 'high',
        preview: buildModerationPreview(reason, envelope),
      };
  }
}

function summarizeServerInstructionUpdate(payload: Record<string, unknown>): GovernanceSummary {
  const operation = asString(payload.operation) ?? 'update';
  const text = asString(payload.newInstructionsText) ?? '';
  return {
    title: 'Server Instructions Review',
    intent: `Apply a ${operation} change to Sage's server instructions`,
    target: 'Guild-wide behavior and persona config',
    impact: 'Changes how Sage behaves for future conversations in this server.',
    risk: operation === 'clear' ? 'critical' : 'high',
    preview: text ? truncate(text, 320) : '[empty]',
  };
}

function summarizeDiscordRestWrite(request: Record<string, unknown>): GovernanceSummary {
  const method = asString(request.method) ?? 'WRITE';
  const path = asString(request.path) ?? '/unknown';
  return {
    title: 'Discord Admin Write Review',
    intent: `${method} ${path}`,
    target: 'Scoped Discord REST write',
    impact: 'Runs a raw Discord admin write in the active guild.',
    risk: method === 'DELETE' ? 'critical' : method === 'POST' ? 'high' : 'medium',
    preview: path,
  };
}

function summarizeApprovalRequest(action: ApprovalReviewRequestRecord): GovernanceSummary {
  const payload = normalizeUnknownRecord(action.executionPayloadJson) ?? {};

  if (action.kind === 'server_instructions_update') {
    return summarizeServerInstructionUpdate(payload);
  }

  if (action.kind === 'discord_queue_moderation_action') {
    const prepared = readPreparedModerationEnvelope(action.executionPayloadJson);
    const moderationAction = normalizeUnknownRecord(prepared?.canonicalAction ?? payload.action) ?? {};
    return summarizeModerationAction(moderationAction, prepared);
  }

  if (action.kind === 'discord_rest_write') {
    const request = normalizeUnknownRecord(payload.request) ?? {};
    return summarizeDiscordRestWrite(request);
  }

  return {
    title: 'Governance Review',
    intent: action.kind,
    target: 'Discord governance action',
    impact: 'Applies a privileged action in this server.',
    risk: 'high',
  };
}

function textBlock(content: string): APITextDisplayComponent {
  return {
    type: ComponentType.TextDisplay,
    content,
  };
}

function separator(): APISeparatorComponent {
  return {
    type: ComponentType.Separator,
    divider: true,
    spacing: SeparatorSpacingSize.Small,
  };
}

function button(params: {
  customId: string;
  label: string;
  style: InteractiveApiButtonStyle;
}): APIButtonComponent {
  return {
    type: ComponentType.Button,
    custom_id: params.customId,
    label: params.label,
    style: params.style,
  };
}

function buildRequesterStateCopy(params: {
  action: ApprovalReviewRequestRecord;
  coalesced?: boolean;
  summary: GovernanceSummary;
}): string[] {
  const { action, coalesced, summary } = params;
  const lines = [
    `**${statusLabel(action, coalesced)}**`,
    summary.intent,
    `Target: ${summary.target}`,
  ];

  if (action.status === 'pending') {
    lines.push(`Review: ${action.reviewChannelId !== action.sourceChannelId ? `<#${action.reviewChannelId}>` : 'this channel'}`);
    lines.push(`Expires: ${formatDiscordTimestamp(action.expiresAt)}`);
  } else if (action.status === 'rejected' && action.decisionReasonText?.trim()) {
    lines.push(`Reason: ${truncate(action.decisionReasonText.trim(), 280)}`);
  } else if (action.status === 'failed' && action.errorText?.trim()) {
    lines.push(`Error: ${truncate(action.errorText.trim(), 280)}`);
  } else if (action.status === 'executed') {
    lines.push('Outcome: Completed successfully.');
  } else if (action.status === 'expired') {
    lines.push('Outcome: Review expired before approval.');
  }

  return lines;
}

export function buildApprovalReviewRequesterCardPayload(params: {
  action: ApprovalReviewRequestRecord;
  coalesced?: boolean;
}): GovernanceMessagePayload {
  const summary = summarizeApprovalRequest(params.action);
  const body = buildRequesterStateCopy({
    action: params.action,
    coalesced: params.coalesced,
    summary,
  }).join('\n');

  const container: APIContainerComponent = {
    type: ComponentType.Container,
    accent_color: accentColorForState(params.action),
    components: [
      textBlock(body),
      separator(),
      textBlock(`Impact: ${summary.impact}`),
    ],
  };

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}

export function buildApprovalReviewReviewerCardPayload(params: {
  action: ApprovalReviewRequestRecord;
  approveCustomId: string;
  rejectCustomId: string;
  detailsCustomId: string;
}): GovernanceMessagePayload {
  const summary = summarizeApprovalRequest(params.action);
  const reviewState = params.action.status === 'pending' ? 'Review required' : statusLabel(params.action);
  const lines = [
    `**${reviewState}**`,
    summary.intent,
    `Requester: <@${params.action.requestedBy}>`,
    `Target: ${summary.target}`,
    `Impact: ${summary.impact}`,
    `Risk: ${riskBadge(summary.risk)}`,
    `Expires: ${formatDiscordTimestamp(params.action.expiresAt)}`,
  ];

  if (summary.preview) {
    lines.push('');
    lines.push(`Preview:\n\`\`\`\n${truncate(summary.preview, 420)}\n\`\`\``);
  }

  const buttons: APIButtonComponent[] = params.action.status === 'pending'
    ? [
        button({
          customId: params.approveCustomId,
          label: 'Approve',
          style: ApiButtonStyle.Success,
        }),
        button({
          customId: params.rejectCustomId,
          label: 'Reject',
          style: ApiButtonStyle.Danger,
        }),
        button({
          customId: params.detailsCustomId,
          label: 'Details',
          style: ApiButtonStyle.Secondary,
        }),
      ]
    : [
        button({
          customId: params.detailsCustomId,
          label: 'Details',
          style: ApiButtonStyle.Secondary,
        }),
      ];

  const actionRow: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: buttons,
  };

  const container: APIContainerComponent = {
    type: ComponentType.Container,
    accent_color: accentColorForState(params.action),
    components: [
      textBlock(lines.join('\n')),
      {
        type: ComponentType.Separator,
        divider: true,
        spacing: SeparatorSpacingSize.Small,
      },
      actionRow,
    ],
  };

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}

export function buildApprovalReviewDetailsText(action: ApprovalReviewRequestRecord): string {
  const summary = summarizeApprovalRequest(action);
  const prepared =
    action.kind === 'discord_queue_moderation_action'
      ? readPreparedModerationEnvelope(action.executionPayloadJson)
      : null;
  const payloadPreview =
    JSON.stringify(sanitizeForDetailView(action.executionPayloadJson), null, 2) ??
    '[no execution payload recorded]';
  const resultPreview = action.resultJson
    ? (JSON.stringify(sanitizeForDetailView(action.resultJson), null, 2) ?? '[unserializable result]')
    : null;

  return [
    `Action ID: \`${action.id}\``,
    `Kind: ${action.kind}`,
    `State: ${statusLabel(action)}`,
    `Requester: <@${action.requestedBy}>`,
    `Source channel: <#${action.sourceChannelId}>`,
    `Review channel: <#${action.reviewChannelId}>`,
    `Risk: ${riskBadge(summary.risk)}`,
    `Intent: ${summary.intent}`,
    `Target: ${summary.target}`,
    `Expires: ${formatDiscordTimestamp(action.expiresAt)}`,
    prepared?.preflight.approverPermission ? `Approver permission: ${prepared.preflight.approverPermission}` : null,
    prepared?.preflight.targetChannelScope ? `Target channel scope: <#${prepared.preflight.targetChannelScope}>` : null,
    prepared?.evidence.messageUrl ? `Message link: ${prepared.evidence.messageUrl}` : null,
    prepared?.evidence.messageAuthorDisplayName
      ? `Evidence author: ${prepared.evidence.messageAuthorDisplayName}${prepared.evidence.messageAuthorId ? ` (${prepared.evidence.messageAuthorId})` : ''}`
      : null,
    prepared?.evidence.messageExcerpt ? `Evidence excerpt: ${truncate(prepared.evidence.messageExcerpt, 500)}` : null,
    prepared && prepared.preflight.botPermissionChecks.length > 0
      ? `Bot checks: ${prepared.preflight.botPermissionChecks.join(', ')}`
      : null,
    prepared && prepared.preflight.notes.length > 0
      ? `Preflight notes: ${prepared.preflight.notes.map((note) => truncate(note, 240)).join(' | ')}`
      : null,
    action.decisionReasonText?.trim() ? `Decision reason: ${truncate(action.decisionReasonText.trim(), 500)}` : null,
    action.errorText?.trim() ? `Error: ${truncate(action.errorText.trim(), 500)}` : null,
    `Payload:\n\`\`\`json\n${truncate(payloadPreview, 1_600)}\n\`\`\``,
    resultPreview ? `Result:\n\`\`\`json\n${truncate(resultPreview, 1_200)}\n\`\`\`` : null,
  ]
    .filter((line): line is string => !!line)
    .join('\n');
}
