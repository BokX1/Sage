export type VoicePresenceMember = {
    userId: string;
    displayName?: string;
    joinedAt: Date;
};

export type VoicePresenceChannel = {
    channelId: string;
    members: VoicePresenceMember[];
};

const guildPresence = new Map<string, Map<string, Map<string, VoicePresenceMember>>>();

function getGuildMap(guildId: string): Map<string, Map<string, VoicePresenceMember>> {
    let guildMap = guildPresence.get(guildId);
    if (!guildMap) {
        guildMap = new Map();
        guildPresence.set(guildId, guildMap);
    }
    return guildMap;
}

export function applyChange(params: {
    guildId: string;
    userId: string;
    displayName?: string;
    oldChannelId: string | null;
    newChannelId: string | null;
    at: Date;
}): void {
    const { guildId, userId, displayName, oldChannelId, newChannelId, at } = params;
    const guildMap = getGuildMap(guildId);

    if (oldChannelId) {
        const channelMap = guildMap.get(oldChannelId);
        if (channelMap) {
            channelMap.delete(userId);
            if (channelMap.size === 0) {
                guildMap.delete(oldChannelId);
            }
        }
    }

    if (newChannelId) {
        let channelMap = guildMap.get(newChannelId);
        if (!channelMap) {
            channelMap = new Map();
            guildMap.set(newChannelId, channelMap);
        }
        channelMap.set(userId, { userId, displayName, joinedAt: at });
    }

    if (guildMap.size === 0) {
        guildPresence.delete(guildId);
    }
}

export function getGuildPresence(guildId: string): VoicePresenceChannel[] {
    const guildMap = guildPresence.get(guildId);
    if (!guildMap) return [];

    return Array.from(guildMap.entries()).map(([channelId, channelMap]) => ({
        channelId,
        members: Array.from(channelMap.values()),
    }));
}

export function clearAll(): void {
    guildPresence.clear();
}
