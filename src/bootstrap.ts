import { client } from './bot/client';
import { registerGuildCreateHandler } from './bot/handlers/guildCreate';
import { registerInteractionCreateHandler } from './bot/handlers/interactionCreate';
import { registerMessageCreateHandler } from './bot/handlers/messageCreate';
import { registerMessageReactionAddHandler } from './bot/handlers/messageReactionAdd';
import { registerReadyHandler } from './bot/handlers/ready';
import { registerVoiceStateUpdateHandler } from './bot/handlers/voiceStateUpdate';
import { config } from './config';
import { assertAgentTraceSchemaReady } from './core/agentRuntime/agent-trace-preflight';
import { registerDefaultAgenticTools } from './core/agentRuntime';
import { registerShutdownHooks } from './core/runtime/shutdown';
import { initChannelSummaryScheduler } from './core/summary/channelSummaryScheduler';
import { startCompactionScheduler } from './core/summary/ltmCompaction';
import { AppError } from './shared/errors/app-error';
import { logger } from './shared/logging/logger';

export async function bootstrapApp(): Promise<void> {
  try {
    if (config.TRACE_ENABLED) {
      await assertAgentTraceSchemaReady();
    }

    registerDefaultAgenticTools();
    registerMessageCreateHandler();
    registerMessageReactionAddHandler();
    registerInteractionCreateHandler();
    registerVoiceStateUpdateHandler();
    registerReadyHandler(client);
    registerGuildCreateHandler(client);
    initChannelSummaryScheduler();
    startCompactionScheduler();
    registerShutdownHooks({ client });

    if (!config.LLM_API_KEY) {
      logger.warn('No LLM API key found. Running with limited/anonymous access if supported.');
    }

    await client.login(config.DISCORD_TOKEN);
  } catch (error) {
    throw new AppError('BOOTSTRAP_FAILED', 'Application bootstrap failed', error);
  }
}
