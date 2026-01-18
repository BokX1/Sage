import { whoIsInVoice, howLongInVoiceToday } from '../../voice/voiceQueries';
import { formatHowLongToday, formatWhoInVoice } from '../../voice/voiceFormat';
import { estimateTokens } from '../../agentRuntime/tokenEstimate';
import { ExpertPacket } from './types';

export interface RunVoiceAnalyticsExpertParams {
  guildId: string;
  userId: string;
  maxChars?: number;
}

/**
 * Voice analytics expert: retrieves voice presence and session data.
 * Returns current voice state and user activity.
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

    const lines: string[] = [];

    // Current presence
    const presenceText = formatWhoInVoice(presence);
    lines.push(`Current voice: ${presenceText}`);

    // Today's activity for this user
    const todayText = formatHowLongToday({ userId, ms: todayData.ms });
    lines.push(`User today: ${todayText}`);

    let content = `Voice analytics:\n${lines.join('\n')}`;

    // Truncate if needed
    if (content.length > maxChars) {
      content = content.slice(0, maxChars).trim() + '\n(truncated)';
    }

    return {
      name: 'VoiceAnalytics',
      content,
      json: {
        channelCount: presence.length,
        totalMembers: presence.reduce((sum, ch) => sum + ch.members.length, 0),
        userTodayMs: todayData.ms,
      },
      tokenEstimate: estimateTokens(content),
    };
  } catch (error) {
    return {
      name: 'VoiceAnalytics',
      content: 'Voice analytics: Error loading voice data.',
      json: { error: String(error) },
      tokenEstimate: 15,
    };
  }
}
