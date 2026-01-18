import { VoiceState, Events } from 'discord.js';
import { client } from '../client';
import { logger } from '../../utils/logger';
import { ingestEvent } from '../../core/ingest/ingestEvent';

const registrationKey = Symbol.for('sage.handlers.voiceStateUpdate.registered');

export async function handleVoiceStateUpdate(
    oldState: VoiceState,
    newState: VoiceState,
): Promise<void> {
    // Determine action
    let action: 'join' | 'leave' | 'move';
    if (!oldState.channelId && newState.channelId) {
        action = 'join';
    } else if (oldState.channelId && !newState.channelId) {
        action = 'leave';
    } else {
        action = 'move';
    }

    await ingestEvent({
        type: 'voice',
        guildId: newState.guild?.id ?? null,
        channelId: newState.channelId ?? oldState.channelId ?? '?',
        userId: newState.member?.id ?? '?',
        action,
        timestamp: new Date(),
    });
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
