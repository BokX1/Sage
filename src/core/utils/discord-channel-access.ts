import { PermissionsBitField, type GuildBasedChannel } from 'discord.js';
import { client } from '../../bot/client';
import { limitConcurrency } from './concurrency';
import { logger } from './logger';

/**
 * Represents the ChannelPermissionRequirement type.
 */
export type ChannelPermissionRequirement = {
  flag: bigint;
  label: string;
};

function hasAllPermissions(
  permissions: Readonly<PermissionsBitField>,
  requirements: ChannelPermissionRequirement[],
): boolean {
  for (const requirement of requirements) {
    if (!permissions.has(requirement.flag)) {
      return false;
    }
  }
  return true;
}

export async function filterChannelIdsByMemberAccess(params: {
  guildId: string;
  userId: string;
  channelIds: string[];
  requirements: ChannelPermissionRequirement[];
}): Promise<Set<string>> {
  const channelIds = Array.from(
    new Set(params.channelIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  );
  if (channelIds.length === 0) return new Set();

  const guild = await client.guilds.fetch(params.guildId);
  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  const userMember = await guild.members.fetch(params.userId).catch(() => null);
  if (!userMember) {
    logger.warn({ guildId: params.guildId, userId: params.userId }, 'Unable to resolve requester member for channel access checks');
    return new Set();
  }

  const runLimited = limitConcurrency(4);
  const decisions = await Promise.all(
    channelIds.map((channelId) =>
      runLimited(async () => {
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) return { channelId, allowed: false };

        const guildChannel = channel as GuildBasedChannel;
        const botPerms = botMember.permissionsIn(guildChannel);
        if (!hasAllPermissions(botPerms, params.requirements)) {
          return { channelId, allowed: false };
        }

        const userPerms = userMember.permissionsIn(guildChannel);
        if (!hasAllPermissions(userPerms, params.requirements)) {
          return { channelId, allowed: false };
        }

        return { channelId, allowed: true };
      }),
    ),
  );

  const allowed = new Set<string>();
  for (const decision of decisions) {
    if (decision.allowed) allowed.add(decision.channelId);
  }
  return allowed;
}

