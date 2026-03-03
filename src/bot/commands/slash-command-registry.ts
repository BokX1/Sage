/**
 * @module src/bot/commands/slash-command-registry
 * @description Defines the slash command registry module.
 */
import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from '../../config';
import { logger } from '../../core/utils/logger';
import { voiceCommands } from './voice-channel-handlers';

/** Static slash command definitions registered with Discord at startup. */
const commandDefinitions = [
  new SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!'),
  ...voiceCommands,
  new SlashCommandBuilder()
    .setName('sage')
    .setDescription('Sage bot commands')
    .addSubcommandGroup((group) =>
      group
        .setName('key')
        .setDescription('Bring Your Own Pollen (BYOP) - Manage Server API key')
        .addSubcommand((sub) =>
          sub.setName('login').setDescription('Get a link to login and generate an API key'),
        )
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('Set the Server-wide Pollinations API key (Admin only)')
            .addStringOption((opt) =>
              opt.setName('api_key').setDescription('Your API Key (sk_...)').setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub.setName('check').setDescription('Check the Server-wide API key status (Admin only)'),
        )
        .addSubcommand((sub) =>
          sub.setName('clear').setDescription('Remove the Server-wide API key (Admin only)'),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('admin')
        .setDescription('Admin-only commands')
        .addSubcommand((sub) => sub.setName('stats').setDescription('Show bot statistics')),
    ),
];

/** Discord slash-command payloads serialized for REST registration. */
export const commandPayloads = commandDefinitions.map((command) => command.toJSON());

interface RegisterCommandsOptions {
  knownGuildIds?: string[];
}

function normalizeGuildIds(guildIds: string[]): string[] {
  return Array.from(
    new Set(
      guildIds
        .map((guildId) => guildId.trim())
        .filter((guildId) => guildId.length > 0),
    ),
  );
}

async function clearGuildScopedCommands(params: {
  rest: REST;
  guildIds: string[];
  appId: string;
  reason: string;
}) {
  for (const guildId of params.guildIds) {
    try {
      logger.info({ guildId, reason: params.reason }, 'Clearing guild-scoped commands');
      await params.rest.put(Routes.applicationGuildCommands(params.appId, guildId), { body: [] });
    } catch (error) {
      logger.warn(
        { error, guildId, reason: params.reason },
        'Failed to clear guild-scoped commands (continuing)',
      );
    }
  }
}

/**
 * Register slash commands either globally or per development guild(s).
 *
 * @returns Promise resolved once all registration calls complete.
 */
export async function registerCommands(options: RegisterCommandsOptions = {}) {
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  const knownGuildIds = normalizeGuildIds(options.knownGuildIds ?? []);
  const devGuildIds = normalizeGuildIds((config.DEV_GUILD_ID ?? '').split(','));

  try {
    if (devGuildIds.length > 0) {
      for (const guildId of devGuildIds) {
        logger.info(`Refreshing application (/) commands for DEV guild: ${guildId}`);
        await rest.put(Routes.applicationGuildCommands(config.DISCORD_APP_ID, guildId), {
          body: commandPayloads,
        });
        logger.info(`Successfully reloaded application (/) commands for DEV guild: ${guildId} (Instant).`);
      }

      logger.info('Clearing GLOBAL commands to prevent duplicates...');
      await rest.put(Routes.applicationCommands(config.DISCORD_APP_ID), { body: [] });
      logger.info('Successfully cleared GLOBAL commands.');

      const staleGuildIds = knownGuildIds.filter((guildId) => !devGuildIds.includes(guildId));
      if (staleGuildIds.length > 0) {
        await clearGuildScopedCommands({
          rest,
          guildIds: staleGuildIds,
          appId: config.DISCORD_APP_ID,
          reason: 'outside configured DEV_GUILD_ID',
        });
      }
    } else {
      logger.info('Refreshing application (/) commands GLOBALLY (may take ~1h to cache).');
      await rest.put(Routes.applicationCommands(config.DISCORD_APP_ID), { body: commandPayloads });
      logger.info('Successfully reloaded application (/) commands GLOBALLY.');

      if (knownGuildIds.length > 0) {
        await clearGuildScopedCommands({
          rest,
          guildIds: knownGuildIds,
          appId: config.DISCORD_APP_ID,
          reason: 'global command mode duplicate prevention',
        });
      }
    }
  } catch (error) {
    logger.error({ error }, 'Slash command registration failed');
  }
}
