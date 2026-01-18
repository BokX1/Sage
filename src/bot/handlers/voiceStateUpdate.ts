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
        const channelId = newState.channelId ?? oldState.channelId ?? null;
        const guildId = newState.guild?.id ?? oldState.guild?.id ?? null;
        if (!channelId || !guildId) return;

        if (!isLoggingEnabled(guildId, channelId)) return;

        const displayName =
            newState.member?.displayName ??
            newState.member?.user?.globalName ??
            newState.member?.user?.username ??
            undefined;

        const change = {
            guildId,
            userId: newState.member?.id ?? newState.id,
            displayName,
            oldChannelId: oldState.channelId ?? null,
            newChannelId: newState.channelId ?? null,
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
            channelId,
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
