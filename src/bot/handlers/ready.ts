import { Client, Events } from 'discord.js';
import { logger } from '../../utils/logger';
import { backfillChannelHistory } from '../../core/ingest/historyBackfill';
import { registerCommands } from '../commands';

const HANDLED_KEY = Symbol.for('sage.handlers.ready');

export function registerReadyHandler(client: Client) {
    const g = globalThis as any;
    if (g[HANDLED_KEY]) return;
    g[HANDLED_KEY] = true;

    client.once(Events.ClientReady, async (c) => {
        logger.info(`Logged in as ${c.user.tag}!`);
        await registerCommands();

        // D1: Backfill history for proactive channels
        // We only backfill channels that are allowed for logging
        // For now, let's just backfill the Dev Guild's channels or any channel in the allowlist?
        // A safe default is to iterate all cached channels and check `isLoggingEnabled` (handled inside backfill)

        logger.info('Starting startup history backfill...');

        const channels = c.channels.cache.filter(
            (ch) => ch.isTextBased() && !ch.isDMBased()
        );

        for (const [id, _] of channels) {
            // We fire and forget each channel to not block startup
            backfillChannelHistory(id, 50).catch(err => {
                logger.warn({ error: err, channelId: id }, 'Startup backfill failed for channel');
            });
        }
    });

    logger.info('Ready handler registered');
}
