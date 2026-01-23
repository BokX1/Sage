import { whoIsInVoice, howLongInVoiceToday } from '../../voice/voiceQueries';
import { estimateTokens } from '../../agentRuntime/tokenEstimate';
import { ExpertPacket } from './types';

export interface RunVoiceAnalyticsExpertParams {
  guildId: string;
  userId: string;
  maxChars?: number;
}

/**
 * Format milliseconds into human-readable duration.
 */
function formatDuration(ms: number): string {
  if (ms === 0) return 'no time';

  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);

  if (hours >= 1) {
    if (minutes > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} and ${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }

  if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  }

  return 'less than a minute';
}

/**
 * Get activity level description based on voice time.
 */
function getActivityLevel(ms: number): string {
  const hours = ms / 3600000;
  if (hours >= 4) return '🔥 Very active';
  if (hours >= 2) return '✨ Active';
  if (hours >= 0.5) return '👍 Moderately active';
  if (ms > 0) return '👋 Briefly active';
  return '💤 Not active in voice today';
}

/**
 * Voice analytics expert: retrieves voice presence and session data.
 * Returns narrative descriptions of voice activity.
 */
export async function runVoiceAnalyticsExpert(
  params: RunVoiceAnalyticsExpertParams,
): Promise<ExpertPacket> {
  const { guildId, userId, maxChars = 1200 } = params;

  try {
    const [presence, todayData] = await Promise.all([
      whoIsInVoice({ guildId }),
      howLongInVoiceToday({ guildId, userId }),
    ]);

    const sections: string[] = [];

    // Current voice presence narrative
    const totalMembers = presence.reduce((sum, ch) => sum + ch.members.length, 0);

    if (totalMembers === 0) {
      sections.push('🔇 **Voice Status**: No one is currently in voice channels.');
    } else {
      const channelDescriptions = presence
        .filter(ch => ch.members.length > 0)
        .map(ch => {
          const memberCount = ch.members.length;
          const memberList = ch.members.slice(0, 3).map(m => `<@${m.userId}>`).join(', ');
          const extra = memberCount > 3 ? ` and ${memberCount - 3} more` : '';
          return `  • **Channel ${ch.channelId}**: ${memberList}${extra}`;
        });

      sections.push(
        `🎤 **Voice Status**: ${totalMembers} member${totalMembers > 1 ? 's' : ''} currently in voice:\n${channelDescriptions.join('\n')}`
      );
    }

    // User's voice activity narrative
    const activityLevel = getActivityLevel(todayData.ms);
    const durationText = formatDuration(todayData.ms);

    if (todayData.ms === 0) {
      sections.push(`\n📊 **Your Voice Activity Today**: ${activityLevel}\nYou haven't joined any voice channels today.`);
    } else {
      sections.push(`\n📊 **Your Voice Activity Today**: ${activityLevel}\nYou've spent ${durationText} in voice today.`);
    }

    // Check if user is currently in voice
    const userInVoice = presence.find(ch => ch.members.some(m => m.userId === userId));
    if (userInVoice) {
      sections.push(`\n🎧 **Currently In**: You're in a voice channel right now.`);
    }

    let content = sections.join('\n');

    // Truncate if needed
    if (content.length > maxChars) {
      content = content.slice(0, maxChars).trim() + '\n(truncated)';
    }

    return {
      name: 'VoiceAnalytics',
      content,
      json: {
        channelCount: presence.length,
        totalMembers,
        userTodayMs: todayData.ms,
        userCurrentlyInVoice: !!userInVoice,
        currentChannelId: userInVoice?.channelId || null,
      },
      tokenEstimate: estimateTokens(content),
    };
  } catch (error) {
    return {
      name: 'VoiceAnalytics',
      content: 'Voice analytics: Unable to load voice data at this time.',
      json: { error: String(error) },
      tokenEstimate: 15,
    };
  }
}
