import { Events, type AutoModerationRule } from 'discord.js';

import { client } from '../../../platform/discord/client';
import { logger } from '../../../platform/logging/logger';
import { importExternalDiscordAutoModerationRules } from '../../../features/moderation/automodSync';

const registrationKey = Symbol.for('sage.handlers.autoModerationRuleDelete.registered');

type GlobalScope = typeof globalThis & {
  [registrationKey]?: boolean;
};

export async function handleAutoModerationRuleDelete(rule: AutoModerationRule): Promise<void> {
  try {
    await importExternalDiscordAutoModerationRules(rule.guild.id);
  } catch (error) {
    logger.error({ error, guildId: rule.guild.id, ruleId: rule.id }, 'AutoModerationRuleDelete handler failed');
  }
}

export function __resetAutoModerationRuleDeleteHandlerStateForTests(): void {
  delete (globalThis as GlobalScope)[registrationKey];
}

export function registerAutoModerationRuleDeleteHandler(): void {
  const globalScope = globalThis as GlobalScope;
  if (globalScope[registrationKey]) {
    logger.warn('AutoModerationRuleDelete handler ALREADY registered (Skip)');
    return;
  }
  globalScope[registrationKey] = true;

  client.on(Events.AutoModerationRuleDelete, (rule) => {
    void handleAutoModerationRuleDelete(rule).catch((error) => {
      logger.error({ error, guildId: rule.guild.id, ruleId: rule.id }, 'AutoModerationRuleDelete handler rejected');
    });
  });
}
