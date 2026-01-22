import dotenv from 'dotenv';

dotenv.config();

const validateEnv = () => {
  if (!process.env.DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN is missing. Set it in your .env or environment.');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is missing. Set it in your .env or environment.');
    process.exit(1);
  }

  if (!process.env.POLLINATIONS_API_KEY) {
    console.warn(
      'No Pollinations key found. Bot will run with limited/anonymous access if supported. Get one at pollinations.ai.',
    );
  }
};

async function main() {
  validateEnv();

  const { client } = await import('./bot/client');
  const { config } = await import('./config');
  const { registerMessageCreateHandler } = await import('./bot/handlers/messageCreate');
  const { registerInteractionCreateHandler } = await import('./bot/handlers/interactionCreate');
  const { registerVoiceStateUpdateHandler } = await import('./bot/handlers/voiceStateUpdate');
  const { initChannelSummaryScheduler } = await import('./core/summary/channelSummaryScheduler');
  const { registerReadyHandler } = await import('./bot/handlers/ready');

  // Register handlers (idempotent)
  registerMessageCreateHandler();
  registerInteractionCreateHandler();
  registerVoiceStateUpdateHandler(); // D1: Voice event ingestion
  registerReadyHandler(client); // D1: Startup backfill & logging
  initChannelSummaryScheduler();

  await client.login(config.DISCORD_TOKEN);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
