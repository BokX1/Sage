import { Client, Events } from 'discord.js';
import { logger } from '../../../platform/logging/logger';
import { backfillChannelHistory } from '../historyBackfill';
import { config as appConfig } from '../../../platform/config/env';

const HANDLED_KEY = Symbol.for('sage.handlers.ready');

export function registerReadyHandler(client: Client) {
  const g = globalThis as unknown as { [key: symbol]: boolean };
  if (g[HANDLED_KEY]) return;
  g[HANDLED_KEY] = true;

  client.once(Events.ClientReady, async (c) => {
    try {
      logger.info(`Logged in as ${c.user.tag}!`);
      // Backfill all cached guild text channels; backfillChannelHistory enforces logging policy per channel.

      const contextTranscriptLimitSource = appConfig.NODE_ENV === 'test' ? 'test-default' : 'env';
      const startupBacklogLimit = appConfig.CONTEXT_TRANSCRIPT_MAX_MESSAGES;

      logger.info(
        {
          contextTranscriptMaxMessages: appConfig.CONTEXT_TRANSCRIPT_MAX_MESSAGES,
          startupBacklogLimit,
          contextTranscriptLimitSource,
          startupBacklogLimitSource: contextTranscriptLimitSource,
        },
        'Startup backlog configuration',
      );

      logger.info('Starting startup history backfill...');

      const channels = c.channels.cache.filter((ch) => ch.isTextBased() && !ch.isDMBased());

      for (const [id] of channels) {
        // We fire and forget each channel to not block startup
        backfillChannelHistory(id, startupBacklogLimit).catch((err) => {
          logger.warn({ error: err, channelId: id }, 'Startup backfill failed for channel');
        });
      }
    } catch (err) {
      logger.error({ err }, 'Ready handler failed');
    }
  });

  logger.info('Ready handler registered');
}
