import { client } from '../bot/client';
import { registerGuildCreateHandler } from '../bot/handlers/guildCreate';
import { registerInteractionCreateHandler } from '../bot/handlers/interactionCreate';
import { registerMessageCreateHandler } from '../bot/handlers/messageCreate';
import { registerReadyHandler } from '../bot/handlers/ready';
import { registerVoiceStateUpdateHandler } from '../bot/handlers/voiceStateUpdate';
import { config } from '../config';
import { registerRuntimeTools } from '../core/agentRuntime/runtime-tools';
import { registerShutdownHooks } from '../core/runtime/shutdown';
import { initChannelSummaryScheduler } from '../core/summary/channelSummaryScheduler';
import { AppError } from '../shared/errors/app-error';
import { logger } from '../shared/logging/logger';

export async function bootstrapApp(): Promise<void> {
  try {
    const registeredTools = registerRuntimeTools();
    logger.info({ tools: registeredTools }, 'Runtime tool protocol enabled');
    logger.info('Voice join/leave tool calls are disabled; use slash commands for voice control.');

    registerMessageCreateHandler();
    registerInteractionCreateHandler();
    registerVoiceStateUpdateHandler();
    registerReadyHandler(client);
    registerGuildCreateHandler(client);
    initChannelSummaryScheduler();
    registerShutdownHooks({ client });

    if (!config.LLM_API_KEY) {
      logger.warn('No LLM API key found. Running with limited/anonymous access if supported.');
    }

    await client.login(config.DISCORD_TOKEN);
  } catch (error) {
    throw new AppError('BOOTSTRAP_FAILED', 'Application bootstrap failed', error);
  }
}
