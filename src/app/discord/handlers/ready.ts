import { Client, Events } from 'discord.js';
import { logger } from '../../../platform/logging/logger';
import { backfillChannelHistory } from '../historyBackfill';
import { config as appConfig } from '../../../platform/config/env';

const HANDLED_KEY = Symbol.for('sage.handlers.ready');

async function clearLegacyApplicationCommands(client: Client): Promise<void> {
  const application = client.application;
  if (!application) {
    return;
  }

  await application.commands.set([]);

  const guilds = [...client.guilds.cache.values()];
  const results = await Promise.allSettled(
    guilds.map(async (guild) => {
      await guild.commands.set([]);
      return guild.id;
    }),
  );

  const clearedGuildCount = results.filter((result) => result.status === 'fulfilled').length;
  const failedGuilds = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);

  logger.info(
    {
      globalCommandsCleared: true,
      clearedGuildCommandSets: clearedGuildCount,
      failedGuildCommandSets: failedGuilds.length,
    },
    'Cleared legacy Discord application commands for commandless runtime',
  );

  for (const error of failedGuilds) {
    logger.warn({ error }, 'Failed to clear legacy guild application commands');
  }
}

export function registerReadyHandler(client: Client) {
  const g = globalThis as unknown as { [key: symbol]: boolean };
  if (g[HANDLED_KEY]) return;
  g[HANDLED_KEY] = true;

  client.once(Events.ClientReady, async (c) => {
    try {
      logger.info(`Logged in as ${c.user.tag}!`);
      await clearLegacyApplicationCommands(c);
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
