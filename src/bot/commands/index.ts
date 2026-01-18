import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from '../../core/config/env';
import { logger } from '../../utils/logger';


const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!'),
  new SlashCommandBuilder()
    .setName('llm_ping')
    .setDescription('Admin: Test LLM connectivity (Config Verification)'),
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
        ),
    ),
].map((command) => command.toJSON());

export async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);

  try {
    logger.info('Started refreshing application (/) commands.');

    await rest.put(Routes.applicationCommands(config.discordAppId), { body: commands });

    logger.info('Successfully reloaded application (/) commands.');
  } catch (error) {
    logger.error(error);
  }
}
