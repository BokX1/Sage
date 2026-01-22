import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from '../../core/config/env';
import { logger } from '../../utils/logger';

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!'),
  new SlashCommandBuilder()
    .setName('llm_ping')
    .setDescription('Admin: Test LLM connectivity (Config Verification)'),
  new SlashCommandBuilder()
    .setName('models')
    .setDescription('Admin: List available models and current selection'),
  new SlashCommandBuilder()
    .setName('setmodel')
    .setDescription('Admin: Set the model for this guild')
    .addStringOption((opt) =>
      opt.setName('model_id').setDescription('Model ID from /models').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('resetmodel')
    .setDescription('Admin: Reset model selection to default'),
  new SlashCommandBuilder()
    .setName('refreshmodels')
    .setDescription('Admin: Refresh the model catalog'),
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
].map((command) => command.toJSON());

export async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);

  try {
    if (config.devGuildId) {
      logger.info(`Refreshing application (/) commands for DEV guild: ${config.devGuildId}`);
      await rest.put(Routes.applicationGuildCommands(config.discordAppId, config.devGuildId), {
        body: commands,
      });
      logger.info('Successfully reloaded application (/) commands for DEV guild (Instant).');
    } else {
      logger.info('Refreshing application (/) commands GLOBALLY (may take ~1h to cache).');
      await rest.put(Routes.applicationCommands(config.discordAppId), { body: commands });
      logger.info('Successfully reloaded application (/) commands GLOBALLY.');
    }
  } catch (error) {
    logger.error(error);
  }
}
