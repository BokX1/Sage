import { Client, GatewayIntentBits, Partials } from 'discord.js';

/**
 * Provide the singleton Discord client used by the bot.
 *
 * @returns The configured Discord.js Client instance.
 *
 * Side effects:
 * - Allocates the client with gateway intents.
 *
 * Error behavior:
 * - Does not throw.
 *
 * Invariants:
 * - Intents include only the lean-core Discord features required by handlers.
 */
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.AutoModerationConfiguration,
    GatewayIntentBits.AutoModerationExecution,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});
