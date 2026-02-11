import { getChannelSummaryStore } from '../../summary/channelSummaryStoreRegistry';
import { ChannelSummary } from '../../summary/channelSummaryStore';
import { estimateTokens } from '../../agentRuntime/tokenEstimate';
import { ContextPacket } from '../context-types';
import { listRecentIngestedAttachments } from '../../attachments/ingestedAttachmentRepo';

export interface RunChannelMemoryProviderParams {
  guildId: string;
  channelId: string;
  maxChars?: number;
  maxItemsPerList?: number;
  maxRecentFiles?: number;
}

function formatAge(updatedAt: Date, nowMs = Date.now()): string {
  const deltaMs = Math.max(0, nowMs - updatedAt.getTime());
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function joinList(values: string[] | undefined, maxItems: number): string | null {
  if (!values || values.length === 0) return null;
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, maxItems)
    .join(', ');
}

function formatWindow(windowStart: Date, windowEnd: Date): string {
  return `${windowStart.toISOString()} -> ${windowEnd.toISOString()}`;
}

function formatSummaryBlock(params: {
  label: string;
  summary: ChannelSummary;
  maxItemsPerList: number;
}): string[] {
  const { label, summary, maxItemsPerList } = params;
  const lines: string[] = [
    `${label} (window ${formatWindow(summary.windowStart, summary.windowEnd)}, updated ${formatAge(summary.updatedAt ?? summary.windowEnd)} ago):`,
    `- Summary: ${summary.summaryText.trim() || '(no summary text)'}`,
  ];

  const listFields: Array<{ key: string; values?: string[] }> = [
    { key: 'Topics', values: summary.topics },
    { key: 'Threads', values: summary.threads },
    { key: 'Decisions', values: summary.decisions },
    { key: 'Action Items', values: summary.actionItems },
    { key: 'Unresolved', values: summary.unresolved },
  ];

  for (const field of listFields) {
    const rendered = joinList(field.values, maxItemsPerList);
    if (!rendered) continue;
    lines.push(`- ${field.key}: ${rendered}`);
  }

  if (summary.sentiment?.trim()) {
    lines.push(`- Sentiment: ${summary.sentiment.trim()}`);
  }

  if (summary.glossary && Object.keys(summary.glossary).length > 0) {
    const glossary = Object.entries(summary.glossary)
      .slice(0, maxItemsPerList)
      .map(([key, value]) => `${key}: ${value}`)
      .join('; ');
    if (glossary) lines.push(`- Glossary: ${glossary}`);
  }

  return lines;
}

function truncateWithEllipsis(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`,
    truncated: true,
  };
}

/**
 * Channel memory provider: gathers best available short-term and long-term channel memory.
 * This provider does not run an LLM; it only retrieves stored summaries.
 */
export async function runChannelMemoryProvider(
  params: RunChannelMemoryProviderParams,
): Promise<ContextPacket> {
  const { guildId, channelId, maxChars = 1800, maxItemsPerList = 5, maxRecentFiles = 5 } = params;

  try {
    const summaryStore = getChannelSummaryStore();

    const recentAttachmentPromise = listRecentIngestedAttachments({
      guildId,
      channelId,
      limit: Math.max(1, Math.min(20, maxRecentFiles)),
    }).catch(() => []);

    const [rollingSummary, profileSummary, recentAttachments] = await Promise.all([
      summaryStore.getLatestSummary({ guildId, channelId, kind: 'rolling' }),
      summaryStore.getLatestSummary({ guildId, channelId, kind: 'profile' }),
      recentAttachmentPromise,
    ]);

    const parts: string[] = [];

    if (rollingSummary) {
      parts.push(
        ...formatSummaryBlock({
          label: 'Short-term memory',
          summary: rollingSummary,
          maxItemsPerList,
        }),
      );
    }

    if (profileSummary) {
      if (parts.length > 0) parts.push('');
      parts.push(
        ...formatSummaryBlock({
          label: 'Long-term memory',
          summary: profileSummary,
          maxItemsPerList,
        }),
      );
    }

    if (recentAttachments.length > 0) {
      if (parts.length > 0) parts.push('');
      parts.push('Recent cached files (retrieve full text with channel_file_lookup when needed):');
      for (const attachment of recentAttachments.slice(0, maxRecentFiles)) {
        parts.push(
          `- ${attachment.filename} (msg:${attachment.messageId}, status=${attachment.status}, extractor=${attachment.extractor ?? 'none'}, cached ${formatAge(attachment.createdAt)} ago)`,
        );
      }
    }

    if (parts.length === 0) {
      return {
        name: 'ChannelMemory',
        content:
          'Channel memory (STM+LTM): no stored channel summaries available yet. Use transcript and current turn context.',
        json: { rollingSummary: null, profileSummary: null, recentAttachmentCount: 0 },
        tokenEstimate: 20,
      };
    }

    const built = ['Channel memory (STM+LTM):', ...parts].join('\n');
    const { text: content, truncated } = truncateWithEllipsis(built, maxChars);
    const rollingAgeHours = rollingSummary?.updatedAt
      ? Math.max(0, (Date.now() - rollingSummary.updatedAt.getTime()) / 3_600_000)
      : null;
    const profileAgeHours = profileSummary?.updatedAt
      ? Math.max(0, (Date.now() - profileSummary.updatedAt.getTime()) / 3_600_000)
      : null;

    return {
      name: 'ChannelMemory',
      content,
      json: {
        hasRolling: !!rollingSummary,
        hasProfile: !!profileSummary,
        recentAttachmentCount: recentAttachments.length,
        recentAttachments: recentAttachments.slice(0, maxRecentFiles).map((attachment) => ({
          filename: attachment.filename,
          messageId: attachment.messageId,
          status: attachment.status,
          extractor: attachment.extractor,
          createdAt: attachment.createdAt.toISOString(),
        })),
        rollingUpdatedAt: rollingSummary?.updatedAt?.toISOString() ?? null,
        profileUpdatedAt: profileSummary?.updatedAt?.toISOString() ?? null,
        rollingLikelyStale: rollingAgeHours !== null ? rollingAgeHours > 24 : null,
        profileLikelyStale: profileAgeHours !== null ? profileAgeHours > 24 * 14 : null,
        truncated,
      },
      tokenEstimate: estimateTokens(content),
    };
  } catch (error) {
    return {
      name: 'ChannelMemory',
      content: 'Channel memory (STM+LTM): error loading summaries.',
      json: { error: String(error) },
      tokenEstimate: 15,
    };
  }
}
