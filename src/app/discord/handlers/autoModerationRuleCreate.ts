import { Events, type AutoModerationRule } from 'discord.js';

import { client } from '../../../platform/discord/client';
import { logger } from '../../../platform/logging/logger';
import { importExternalDiscordAutoModerationRules } from '../../../features/moderation/automodSync';

const registrationKey = Symbol.for('sage.handlers.autoModerationRuleCreate.registered');

type GlobalScope = typeof globalThis & {
  [registrationKey]?: boolean;
};

async function syncGuild(rule: AutoModerationRule): Promise<void> {
  await importExternalDiscordAutoModerationRules(rule.guild.id);
}

export async function handleAutoModerationRuleCreate(rule: AutoModerationRule): Promise<void> {
  try {
    await syncGuild(rule);
  } catch (error) {
    logger.error({ error, guildId: rule.guild.id, ruleId: rule.id }, 'AutoModerationRuleCreate handler failed');
  }
}

export function __resetAutoModerationRuleCreateHandlerStateForTests(): void {
  delete (globalThis as GlobalScope)[registrationKey];
}

export function registerAutoModerationRuleCreateHandler(): void {
  const globalScope = globalThis as GlobalScope;
  if (globalScope[registrationKey]) {
    logger.warn('AutoModerationRuleCreate handler ALREADY registered (Skip)');
    return;
  }
  globalScope[registrationKey] = true;

  client.on(Events.AutoModerationRuleCreate, (rule) => {
    void handleAutoModerationRuleCreate(rule).catch((error) => {
      logger.error({ error, guildId: rule.guild.id, ruleId: rule.id }, 'AutoModerationRuleCreate handler rejected');
    });
  });
}
