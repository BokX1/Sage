import { Events, type AutoModerationActionExecution } from 'discord.js';

import { client } from '../../../platform/discord/client';
import { logger } from '../../../platform/logging/logger';
import { recordNativeAutoModerationExecution } from '../../../features/moderation/runtime';

const registrationKey = Symbol.for('sage.handlers.autoModerationActionExecution.registered');

type GlobalScope = typeof globalThis & {
  [registrationKey]?: boolean;
};

export async function handleAutoModerationActionExecution(
  execution: AutoModerationActionExecution,
): Promise<void> {
  try {
    await recordNativeAutoModerationExecution({ execution });
  } catch (error) {
    logger.error({ error, guildId: execution.guild.id, ruleId: execution.ruleId }, 'AutoModerationActionExecution handler failed');
  }
}

export function __resetAutoModerationActionExecutionHandlerStateForTests(): void {
  delete (globalThis as GlobalScope)[registrationKey];
}

export function registerAutoModerationActionExecutionHandler(): void {
  const globalScope = globalThis as GlobalScope;
  if (globalScope[registrationKey]) {
    logger.warn('AutoModerationActionExecution handler ALREADY registered (Skip)');
    return;
  }
  globalScope[registrationKey] = true;

  client.on(Events.AutoModerationActionExecution, (execution) => {
    void handleAutoModerationActionExecution(execution).catch((error) => {
      logger.error({ error, guildId: execution.guild.id, ruleId: execution.ruleId }, 'AutoModerationActionExecution handler rejected');
    });
  });
}
