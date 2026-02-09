import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from '../../core/config/legacy-config-adapter';
import { logger } from '../../core/utils/logger';
import { voiceCommands } from './voice-channel-handlers';

/** Static slash command definitions registered with Discord at startup. */
const commandDefinitions = [
  new SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!'),
  new SlashCommandBuilder()
    .setName('llm_ping')
    .setDescription('Admin: Test LLM connectivity (Config Verification)'),
  ...voiceCommands,
  new SlashCommandBuilder()
    .setName('sage')
    .setDescription('Sage bot commands')
    .addSubcommand((sub) =>
      sub
        .setName('whoiswho')
        .setDescription('Show relationship info for users')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('User to inspect (optional)').setRequired(false),
        ),
    )
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
        .setName('relationship')
        .setDescription('Relationship management')
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('Set relationship level between users (admin only)')
            .addUserOption((opt) =>
              opt.setName('user_a').setDescription('First user').setRequired(true),
            )
            .addUserOption((opt) =>
              opt.setName('user_b').setDescription('Second user').setRequired(true),
            )
            .addNumberOption((opt) =>
              opt
                .setName('level')
                .setDescription('Relationship level (0.0-1.0)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(1),
            ),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('admin')
        .setDescription('Admin-only commands')
        .addSubcommand((sub) => sub.setName('stats').setDescription('Show bot statistics'))
        .addSubcommand((sub) =>
          sub
            .setName('relationship_graph')
            .setDescription('Show relationship graph')
            .addUserOption((opt) =>
              opt.setName('user').setDescription('Filter by user (optional)').setRequired(false),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('trace')
            .setDescription('View recent agent traces')
            .addStringOption((opt) =>
              opt.setName('trace_id').setDescription('Specific trace ID').setRequired(false),
            )
            .addIntegerOption((opt) =>
              opt
                .setName('limit')
                .setDescription('Number of traces (1-10)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(10),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('summarize')
            .setDescription('Manually trigger channel summary (Admin only)')
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Channel to summarize (defaults to current)')
                .setRequired(false),
            ),
        ),
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
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const knownGuildIds = normalizeGuildIds(options.knownGuildIds ?? []);
  const devGuildIds = normalizeGuildIds((config.devGuildId ?? '').split(','));

  try {
    if (devGuildIds.length > 0) {
      for (const guildId of devGuildIds) {
        logger.info(`Refreshing application (/) commands for DEV guild: ${guildId}`);
        await rest.put(Routes.applicationGuildCommands(config.discordAppId, guildId), {
          body: commandPayloads,
        });
        logger.info(`Successfully reloaded application (/) commands for DEV guild: ${guildId} (Instant).`);
      }

      logger.info('Clearing GLOBAL commands to prevent duplicates...');
      await rest.put(Routes.applicationCommands(config.discordAppId), { body: [] });
      logger.info('Successfully cleared GLOBAL commands.');

      const staleGuildIds = knownGuildIds.filter((guildId) => !devGuildIds.includes(guildId));
      if (staleGuildIds.length > 0) {
        await clearGuildScopedCommands({
          rest,
          guildIds: staleGuildIds,
          appId: config.discordAppId,
          reason: 'outside configured DEV_GUILD_ID',
        });
      }
    } else {
      logger.info('Refreshing application (/) commands GLOBALLY (may take ~1h to cache).');
      await rest.put(Routes.applicationCommands(config.discordAppId), { body: commandPayloads });
      logger.info('Successfully reloaded application (/) commands GLOBALLY.');

      if (knownGuildIds.length > 0) {
        await clearGuildScopedCommands({
          rest,
          guildIds: knownGuildIds,
          appId: config.discordAppId,
          reason: 'global command mode duplicate prevention',
        });
      }
    }
  } catch (error) {
    logger.error({ error }, 'Slash command registration failed');
  }
}
