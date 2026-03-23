import { Events, type AutoModerationRule } from 'discord.js';

import { client } from '../../../platform/discord/client';
import { logger } from '../../../platform/logging/logger';
import { importExternalDiscordAutoModerationRules } from '../../../features/moderation/automodSync';

const registrationKey = Symbol.for('sage.handlers.autoModerationRuleUpdate.registered');

type GlobalScope = typeof globalThis & {
  [registrationKey]?: boolean;
};

export async function handleAutoModerationRuleUpdate(
  _oldRule: AutoModerationRule | null,
  newRule: AutoModerationRule,
): Promise<void> {
  try {
    await importExternalDiscordAutoModerationRules(newRule.guild.id);
  } catch (error) {
    logger.error({ error, guildId: newRule.guild.id, ruleId: newRule.id }, 'AutoModerationRuleUpdate handler failed');
  }
}

export function __resetAutoModerationRuleUpdateHandlerStateForTests(): void {
  delete (globalThis as GlobalScope)[registrationKey];
}

export function registerAutoModerationRuleUpdateHandler(): void {
  const globalScope = globalThis as GlobalScope;
  if (globalScope[registrationKey]) {
    logger.warn('AutoModerationRuleUpdate handler ALREADY registered (Skip)');
    return;
  }
  globalScope[registrationKey] = true;

  client.on(Events.AutoModerationRuleUpdate, (oldRule, newRule) => {
    void handleAutoModerationRuleUpdate(oldRule, newRule).catch((error) => {
      logger.error({ error, guildId: newRule.guild.id, ruleId: newRule.id }, 'AutoModerationRuleUpdate handler rejected');
    });
  });
}
