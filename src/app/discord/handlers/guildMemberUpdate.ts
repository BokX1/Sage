import { Events, GuildMember, type PartialGuildMember } from 'discord.js';

import { client } from '../../../platform/discord/client';
import { logger } from '../../../platform/logging/logger';
import { evaluateMemberProfileModeration } from '../../../features/moderation/runtime';

const registrationKey = Symbol.for('sage.handlers.guildMemberUpdate.registered');

type GlobalScope = typeof globalThis & {
  [registrationKey]?: boolean;
};

async function resolveMember(member: GuildMember | PartialGuildMember): Promise<GuildMember | null> {
  if (!member.partial) {
    return member;
  }
  return member.fetch().catch(() => null);
}

export async function handleGuildMemberUpdate(
  _oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember | PartialGuildMember,
): Promise<void> {
  try {
    const member = await resolveMember(newMember);
    if (!member) {
      return;
    }
    await evaluateMemberProfileModeration(member);
  } catch (error) {
    logger.error({ error, guildId: newMember.guild.id, userId: newMember.id }, 'GuildMemberUpdate moderation handler failed');
  }
}

export function __resetGuildMemberUpdateHandlerStateForTests(): void {
  delete (globalThis as GlobalScope)[registrationKey];
}

export function registerGuildMemberUpdateHandler(): void {
  const globalScope = globalThis as GlobalScope;
  if (globalScope[registrationKey]) {
    logger.warn('GuildMemberUpdate handler ALREADY registered (Skip)');
    return;
  }
  globalScope[registrationKey] = true;

  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    void handleGuildMemberUpdate(oldMember, newMember).catch((error) => {
      logger.error({ error, guildId: newMember.guild.id, userId: newMember.id }, 'GuildMemberUpdate handler rejected');
    });
  });
}
