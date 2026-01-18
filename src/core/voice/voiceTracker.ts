export type VoiceChange = {
    guildId: string;
    userId: string;
    displayName?: string;
    oldChannelId: string | null;
    newChannelId: string | null;
    at: Date;
};

export type VoiceChangeKind = 'join' | 'leave' | 'move' | 'noop';

export type VoicePresenceIndex = {
    applyChange: (params: {
        guildId: string;
        userId: string;
        displayName?: string;
        oldChannelId: string | null;
        newChannelId: string | null;
        at: Date;
    }) => void;
};

export type VoiceSessionRepo = {
    startSession: (params: {
        guildId: string;
        channelId: string;
        userId: string;
        displayName?: string;
        startedAt: Date;
    }) => Promise<void>;
    endOpenSession: (params: { guildId: string; userId: string; endedAt: Date }) => Promise<void>;
};

export type VoiceTrackerLogger = {
    warn: (obj: Record<string, unknown>, msg: string) => void;
    error: (obj: Record<string, unknown>, msg: string) => void;
};

export function classifyVoiceChange(change: VoiceChange): VoiceChangeKind {
    if (!change.oldChannelId && change.newChannelId) return 'join';
    if (change.oldChannelId && !change.newChannelId) return 'leave';
    if (change.oldChannelId && change.newChannelId && change.oldChannelId !== change.newChannelId) {
        return 'move';
    }
    return 'noop';
}

export async function handleVoiceChange(
    change: VoiceChange,
    deps: {
        presenceIndex: VoicePresenceIndex;
        voiceSessionRepo: VoiceSessionRepo;
        logger: VoiceTrackerLogger;
    },
): Promise<void> {
    const action = classifyVoiceChange(change);
    if (action === 'noop') return;

    try {
        deps.presenceIndex.applyChange(change);
    } catch (error) {
        deps.logger.error({ error, change }, 'Voice presence update failed (non-fatal)');
    }

    if (action === 'join') {
        try {
            await deps.voiceSessionRepo.startSession({
                guildId: change.guildId,
                channelId: change.newChannelId as string,
                userId: change.userId,
                displayName: change.displayName,
                startedAt: change.at,
            });
        } catch (error) {
            deps.logger.error({ error, change }, 'Voice session start failed (non-fatal)');
        }
    }

    if (action === 'leave') {
        try {
            await deps.voiceSessionRepo.endOpenSession({
                guildId: change.guildId,
                userId: change.userId,
                endedAt: change.at,
            });
        } catch (error) {
            deps.logger.error({ error, change }, 'Voice session end failed (non-fatal)');
        }
    }

    if (action === 'move') {
        try {
            await deps.voiceSessionRepo.endOpenSession({
                guildId: change.guildId,
                userId: change.userId,
                endedAt: change.at,
            });
        } catch (error) {
            deps.logger.error({ error, change }, 'Voice session end (move) failed (non-fatal)');
        }

        try {
            await deps.voiceSessionRepo.startSession({
                guildId: change.guildId,
                channelId: change.newChannelId as string,
                userId: change.userId,
                displayName: change.displayName,
                startedAt: change.at,
            });
        } catch (error) {
            deps.logger.error({ error, change }, 'Voice session start (move) failed (non-fatal)');
        }
    }
}
