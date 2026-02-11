import { getUserProfileRecord } from '../../memory/userProfileRepo';
import { estimateTokens } from '../../agentRuntime/tokenEstimate';
import { ContextPacket } from '../context-types';

export interface RunUserMemoryProviderParams {
  userId: string;
  maxChars?: number;
  maxItemsPerSection?: number;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractSection(summary: string, heading: string): string[] {
  const pattern = new RegExp(
    `###\\s*${escapeRegex(heading)}\\s*\\n([\\s\\S]*?)(?=\\n###\\s|$)`,
    'i',
  );
  const match = summary.match(pattern);
  if (!match) return [];

  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .map((line) => collapseWhitespace(line))
    .filter((line) => line.length > 0);
}

function trimToChars(value: string, maxChars: number): { text: string; truncated: boolean } {
  const normalized = value.trim();
  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false };
  }
  return {
    text: `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`,
    truncated: true,
  };
}

function formatRelativeAge(updatedAt: Date, nowMs = Date.now()): string {
  const deltaMs = Math.max(0, nowMs - updatedAt.getTime());
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function joinItems(items: string[], maxItems: number): string {
  const limited = items.slice(0, maxItems);
  return limited.length > 0 ? limited.join(' | ') : 'none';
}

/**
 * User memory provider: retrieves long-term profile guidance for personalization.
 */
export async function runUserMemoryProvider(
  params: RunUserMemoryProviderParams,
): Promise<ContextPacket> {
  const { userId, maxChars = 1400, maxItemsPerSection = 3 } = params;

  try {
    const profile = await getUserProfileRecord(userId);
    const summary = profile?.summary?.trim() ?? '';

    if (!summary) {
      return {
        name: 'UserMemory',
        content:
          'User memory profile: no stored personalization profile yet. Use this turn only and ask clarifying questions when needed.',
        json: { summary: null },
        tokenEstimate: 22,
      };
    }

    const directives = extractSection(summary, 'Directives');
    const activeFocus = extractSection(summary, 'Active Focus');
    const userContext = extractSection(summary, 'User Context');

    const fallbackSummary = collapseWhitespace(
      summary.replace(/^###\s*(Directives|Active Focus|User Context)\s*$/gim, ''),
    );

    const lines: string[] = ['User memory profile:'];
    if (directives.length > 0) {
      lines.push(`- Directives: ${joinItems(directives, maxItemsPerSection)}`);
    }
    if (activeFocus.length > 0) {
      lines.push(`- Active focus: ${joinItems(activeFocus, maxItemsPerSection)}`);
    }
    if (userContext.length > 0) {
      lines.push(`- User context: ${joinItems(userContext, maxItemsPerSection)}`);
    }
    if (directives.length === 0 && activeFocus.length === 0 && userContext.length === 0) {
      lines.push(`- Notes: ${trimToChars(fallbackSummary, 500).text}`);
    }
    if (profile?.updatedAt) {
      lines.push(`- Freshness: profile updated ${formatRelativeAge(profile.updatedAt)} ago.`);
    }
    lines.push(
      '- Guidance: prefer these as soft personalization cues; prioritize explicit user instructions in this turn.',
    );

    const built = lines.join('\n');
    const { text: content, truncated } = trimToChars(built, maxChars);

    return {
      name: 'UserMemory',
      content,
      json: {
        summaryChars: summary.length,
        directives,
        activeFocus,
        userContext,
        updatedAt: profile?.updatedAt?.toISOString() ?? null,
        truncated,
      },
      tokenEstimate: estimateTokens(content),
    };
  } catch (error) {
    return {
      name: 'UserMemory',
      content: 'User memory profile: error loading profile data.',
      json: { error: String(error) },
      tokenEstimate: 15,
    };
  }
}
