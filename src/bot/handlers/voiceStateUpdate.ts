import { VoiceState, Events } from 'discord.js';
import { client } from '../client';
import { logger } from '../../utils/logger';
import { ingestEvent } from '../../core/ingest/ingestEvent';
import { isLoggingEnabled } from '../../core/settings/guildChannelSettings';
import { applyChange } from '../../core/voice/voicePresenceIndex';
import { startSession, endOpenSession } from '../../core/voice/voiceSessionRepo';
import { classifyVoiceChange, handleVoiceChange } from '../../core/voice/voiceTracker';

const registrationKey = Symbol.for('sage.handlers.voiceStateUpdate.registered');

export async function handleVoiceStateUpdate(
    oldState: VoiceState,
    newState: VoiceState,
): Promise<void> {
    try {
        const oldChannelId = oldState.channelId ?? null;
        const newChannelId = newState.channelId ?? null;
        const guildId = newState.guild?.id ?? oldState.guild?.id ?? null;
        if (!guildId || (!oldChannelId && !newChannelId)) return;

        const shouldLogOld = oldChannelId ? isLoggingEnabled(guildId, oldChannelId) : false;
        const shouldLogNew = newChannelId ? isLoggingEnabled(guildId, newChannelId) : false;
        if (!shouldLogOld && !shouldLogNew) return;

        const displayName =
            newState.member?.displayName ??
            newState.member?.user?.globalName ??
            newState.member?.user?.username ??
            undefined;

        const change = {
            guildId,
            userId: newState.member?.id ?? newState.id,
            displayName,
            oldChannelId: shouldLogOld ? oldChannelId : null,
            newChannelId: shouldLogNew ? newChannelId : null,
            at: new Date(),
        };

        const action = classifyVoiceChange(change);
        if (action === 'noop') return;

        await handleVoiceChange(change, {
            presenceIndex: { applyChange },
            voiceSessionRepo: { startSession, endOpenSession },
            logger,
        });

        await ingestEvent({
            type: 'voice',
            guildId,
            channelId: change.newChannelId ?? change.oldChannelId ?? '?',
            userId: change.userId,
            action,
            timestamp: change.at,
        });
    } catch (error) {
        logger.error({ error }, 'VoiceStateUpdate handler failed (non-fatal)');
    }
}

export function registerVoiceStateUpdateHandler() {
    const g = globalThis as any;
    if (g[registrationKey]) {
        return;
    }
    g[registrationKey] = true;

    client.on(Events.VoiceStateUpdate, handleVoiceStateUpdate);
    logger.info(
        { count: client.listenerCount(Events.VoiceStateUpdate) },
        'VoiceStateUpdate handler registered',
    );
}
