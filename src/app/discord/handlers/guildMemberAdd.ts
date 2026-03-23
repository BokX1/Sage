import { Events, GuildMember } from 'discord.js';

import { client } from '../../../platform/discord/client';
import { logger } from '../../../platform/logging/logger';
import { evaluateMemberJoinModeration } from '../../../features/moderation/runtime';

const registrationKey = Symbol.for('sage.handlers.guildMemberAdd.registered');

type GlobalScope = typeof globalThis & {
  [registrationKey]?: boolean;
};

export async function handleGuildMemberAdd(member: GuildMember): Promise<void> {
  try {
    await evaluateMemberJoinModeration(member);
  } catch (error) {
    logger.error({ error, guildId: member.guild.id, userId: member.id }, 'GuildMemberAdd moderation handler failed');
  }
}

export function __resetGuildMemberAddHandlerStateForTests(): void {
  delete (globalThis as GlobalScope)[registrationKey];
}

export function registerGuildMemberAddHandler(): void {
  const globalScope = globalThis as GlobalScope;
  if (globalScope[registrationKey]) {
    logger.warn('GuildMemberAdd handler ALREADY registered (Skip)');
    return;
  }
  globalScope[registrationKey] = true;

  client.on(Events.GuildMemberAdd, (member) => {
    void handleGuildMemberAdd(member).catch((error) => {
      logger.error({ error, guildId: member.guild.id, userId: member.id }, 'GuildMemberAdd handler rejected');
    });
  });
}
