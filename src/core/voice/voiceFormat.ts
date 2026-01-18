import { VoicePresenceChannel } from './voicePresenceIndex';

function formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const totalMinutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
        return `${minutes}m`;
    }
    return `${seconds}s`;
}

export function formatWhoInVoice(presence: VoicePresenceChannel[]): string {
    if (presence.length === 0) {
        return 'No one is in voice right now.';
    }

    const lines = ['In voice right now:'];
    for (const channel of presence) {
        const members =
            channel.members.length > 0
                ? channel.members
                      .map((member) => member.displayName ?? `<@${member.userId}>`)
                      .join(', ')
                : '(empty)';
        lines.push(`- Channel <#${channel.channelId}>: ${members}`);
    }
    return lines.join('\n');
}

export function formatHowLongToday(params: { userId: string; ms: number }): string {
    const duration = formatDuration(params.ms);
    return `<@${params.userId}> has been in voice for ~${duration} today (UTC).`;
}
