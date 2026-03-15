import { client } from '../platform/discord/client';
import { registerGuildCreateHandler } from './discord/handlers/guildCreate';
import { registerInteractionCreateHandler } from './discord/handlers/interactionCreate';
import { registerMessageCreateHandler } from './discord/handlers/messageCreate';
import { registerMessageUpdateHandler } from './discord/handlers/messageUpdate';
import { registerMessageReactionAddHandler } from './discord/handlers/messageReactionAdd';
import { registerReadyHandler } from './discord/handlers/ready';
import { registerVoiceStateUpdateHandler } from './discord/handlers/voiceStateUpdate';
import { initApprovalCardCleanupScheduler } from '../features/admin/approvalCardCleanupScheduler';
import { config } from '../platform/config/env';
import { assertAgentTraceSchemaReady } from '../features/agent-runtime/agent-trace-preflight';
import { registerDefaultAgenticTools } from '../features/agent-runtime';
import { initializeAgentGraphRuntime } from '../features/agent-runtime/langgraph/runtime';
import { registerShutdownHooks } from './runtime/shutdown';
import { initChannelSummaryScheduler } from '../features/summary/channelSummaryScheduler';
import { startCompactionScheduler } from '../features/summary/ltmCompaction';
import { initImageAttachmentRecallWorker } from '../features/attachments/imageAttachmentRecallWorker';
import { AppError } from '../shared/errors/app-error';
import { logger } from '../platform/logging/logger';

export async function bootstrapApp(): Promise<void> {
  try {
    if (config.SAGE_TRACE_DB_ENABLED) {
      await assertAgentTraceSchemaReady();
    }

    registerDefaultAgenticTools();
    await initializeAgentGraphRuntime();
    registerMessageCreateHandler();
    registerMessageUpdateHandler();
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

    if (!config.AI_PROVIDER_API_KEY) {
      logger.warn(
        'No host-level AI provider key found. Sage can still respond if a server admin configures an in-Discord server API key.',
      );
    }

    await client.login(config.DISCORD_TOKEN);
  } catch (error) {
    throw new AppError('BOOTSTRAP_FAILED', 'Application bootstrap failed', error);
  }
}
