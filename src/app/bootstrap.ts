import { client } from '../platform/discord/client';
import { registerGuildCreateHandler } from './discord/handlers/guildCreate';
import { registerInteractionCreateHandler } from './discord/handlers/interactionCreate';
import { registerMessageCreateHandler } from './discord/handlers/messageCreate';
import { registerMessageReactionAddHandler } from './discord/handlers/messageReactionAdd';
import { registerReadyHandler } from './discord/handlers/ready';
import { registerVoiceStateUpdateHandler } from './discord/handlers/voiceStateUpdate';
import { initApprovalCardCleanupScheduler } from '../features/admin/approvalCardCleanupScheduler';
import { config } from '../platform/config/env';
import { assertAgentTraceSchemaReady } from '../features/agent-runtime/agent-trace-preflight';
import { registerDefaultAgenticTools } from '../features/agent-runtime';
import { registerShutdownHooks } from './runtime/shutdown';
import { initChannelSummaryScheduler } from '../features/summary/channelSummaryScheduler';
import { startCompactionScheduler } from '../features/summary/ltmCompaction';
import { initImageAttachmentRecallWorker } from '../features/attachments/imageAttachmentRecallWorker';
import { AppError } from '../shared/errors/app-error';
import { logger } from '../platform/logging/logger';

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
    initImageAttachmentRecallWorker();
    initApprovalCardCleanupScheduler();
    registerShutdownHooks({ client });

    if (!config.LLM_API_KEY) {
      logger.warn('No host-level LLM_API_KEY found. Sage can still respond if a server configures a Pollinations BYOP key with /sage key set.');
    }

    await client.login(config.DISCORD_TOKEN);
  } catch (error) {
    throw new AppError('BOOTSTRAP_FAILED', 'Application bootstrap failed', error);
  }
}
