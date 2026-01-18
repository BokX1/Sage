import { getGuildPresence } from './voicePresenceIndex';
import { getUserSessionsInRange, VoiceSession } from './voiceSessionRepo';

export async function whoIsInVoice(params: { guildId: string }) {
    return getGuildPresence(params.guildId);
}

export async function howLongInVoiceToday(params: {
    guildId: string;
    userId: string;
    now?: Date;
    repo?: {
        getUserSessionsInRange: (args: {
            guildId: string;
            userId: string;
            start: Date;
            end: Date;
        }) => Promise<VoiceSession[]>;
    };
}): Promise<{ ms: number; sessions: VoiceSession[]; rangeStart: Date; rangeEnd: Date }> {
    const now = params.now ?? new Date();
    const rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const rangeEnd = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    const repo = params.repo ?? { getUserSessionsInRange };
    const sessions = await repo.getUserSessionsInRange({
        guildId: params.guildId,
        userId: params.userId,
        start: rangeStart,
        end: rangeEnd,
    });

    let totalMs = 0;
    for (const session of sessions) {
        const sessionStart = session.startedAt;
        const sessionEnd = session.endedAt ?? now;
        const overlapStart = sessionStart > rangeStart ? sessionStart : rangeStart;
        const overlapEnd = sessionEnd < rangeEnd ? sessionEnd : rangeEnd;
        if (overlapEnd > overlapStart) {
            totalMs += overlapEnd.getTime() - overlapStart.getTime();
        }
    }

    return { ms: totalMs, sessions, rangeStart, rangeEnd };
}
