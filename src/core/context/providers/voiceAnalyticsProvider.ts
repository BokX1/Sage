import { howLongInVoiceToday, whoIsInVoice } from '../../voice/voiceQueries';
import { estimateTokens } from '../../agentRuntime/tokenEstimate';
import { ContextPacket } from '../context-types';

export interface RunVoiceAnalyticsProviderParams {
  guildId: string;
  userId: string;
  maxChars?: number;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0m';
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function classifyActivity(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours >= 4) return 'high';
  if (hours >= 2) return 'active';
  if (hours >= 0.5) return 'moderate';
  if (hours > 0) return 'light';
  return 'none';
}

function truncateWithEllipsis(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`,
    truncated: true,
  };
}

/**
 * Voice analytics provider: retrieves current voice presence and today's user voice activity.
 */
export async function runVoiceAnalyticsProvider(
  params: RunVoiceAnalyticsProviderParams,
): Promise<ContextPacket> {
  const { guildId, userId, maxChars = 1800 } = params;

  try {
    const [presence, todayData] = await Promise.all([
      whoIsInVoice({ guildId }),
      howLongInVoiceToday({ guildId, userId }),
    ]);

    const lines: string[] = ['Voice analytics memory:'];
    const activeChannels = presence.filter((channel) => channel.members.length > 0);
    const totalMembers = activeChannels.reduce((sum, channel) => sum + channel.members.length, 0);
    const userPresenceChannel = activeChannels.find((channel) =>
      channel.members.some((member) => member.userId === userId),
    );
    const userPresenceMember = userPresenceChannel?.members.find((member) => member.userId === userId);

    lines.push(
      `- Current voice presence: ${totalMembers} member(s) across ${activeChannels.length} active channel(s).`,
    );
    if (activeChannels.length === 0) {
      lines.push('- Active channels: none.');
    } else {
      lines.push('- Active channels:');
      for (const channel of activeChannels) {
        const visibleMembers = channel.members.slice(0, 4).map((member) => `<@${member.userId}>`);
        const overflow = channel.members.length - visibleMembers.length;
        const memberList =
          overflow > 0 ? `${visibleMembers.join(', ')} (+${overflow} more)` : visibleMembers.join(', ');
        lines.push(`  - <#${channel.channelId}>: ${memberList}`);
      }
    }

    const sessions = todayData.sessions;
    const now = new Date();
    const longestSessionMs = sessions.reduce((maxMs, session) => {
      const endAt = session.endedAt ?? now;
      const duration = Math.max(0, endAt.getTime() - session.startedAt.getTime());
      return Math.max(maxMs, duration);
    }, 0);
    const activity = classifyActivity(todayData.ms);

    lines.push(`- User daily voice time (UTC day): ${formatDuration(todayData.ms)}.`);
    lines.push(`- User daily session count: ${sessions.length}.`);
    lines.push(`- User longest session today: ${formatDuration(longestSessionMs)}.`);
    lines.push(`- User activity band: ${activity}.`);
    lines.push(`- User currently in voice: ${userPresenceChannel ? 'yes' : 'no'}.`);

    if (userPresenceChannel && userPresenceMember) {
      const currentSessionMs = Math.max(0, Date.now() - userPresenceMember.joinedAt.getTime());
      lines.push(`- User current channel: <#${userPresenceChannel.channelId}>.`);
      lines.push(`- User current session duration: ${formatDuration(currentSessionMs)}.`);
    }

    const built = lines.join('\n');
    const { text: content, truncated } = truncateWithEllipsis(built, maxChars);

    return {
      name: 'VoiceAnalytics',
      content,
      json: {
        activeChannelCount: activeChannels.length,
        totalMembers,
        userTodayMs: todayData.ms,
        userTodaySessionCount: sessions.length,
        userLongestSessionMs: longestSessionMs,
        userActivityBand: activity,
        userCurrentlyInVoice: !!userPresenceChannel,
        currentChannelId: userPresenceChannel?.channelId ?? null,
        truncated,
      },
      tokenEstimate: estimateTokens(content),
    };
  } catch (error) {
    return {
      name: 'VoiceAnalytics',
      content: 'Voice analytics memory: unable to load voice data at this time.',
      json: { error: String(error) },
      tokenEstimate: 15,
    };
  }
}
