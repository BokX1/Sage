import { client } from './bot/client';
import { config } from './config';
import { logger } from './utils/logger';
import { registerCommands } from './bot/commands';
import { registerMessageCreateHandler } from './bot/handlers/messageCreate';
import { registerInteractionCreateHandler } from './bot/handlers/interactionCreate';
import { registerVoiceStateUpdateHandler } from './bot/handlers/voiceStateUpdate';

async function main() {
  if (!config.DISCORD_TOKEN) {
    logger.error('DISCORD_TOKEN is missing');
    process.exit(1);
  }

  // Register handlers (idempotent)
  registerMessageCreateHandler();
  registerInteractionCreateHandler();
  registerVoiceStateUpdateHandler(); // D1: Voice event ingestion

  client.once('ready', async () => {
    logger.info(`Logged in as ${client.user?.tag}! (Sage v0.1 Beta - Ready)`);
    await registerCommands();
  });

  await client.login(config.DISCORD_TOKEN);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
