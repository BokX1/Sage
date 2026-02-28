import { ChannelType, Client, Events, Guild, TextChannel } from 'discord.js';
import { logger } from '../../core/utils/logger';
import { getWelcomeMessage } from './welcomeMessage';

const registrationKey = Symbol.for('sage.handlers.guildCreate.registered');

function canSendInChannel(guild: Guild, channel: TextChannel): boolean {
  const me = guild.members.me;
  if (!me) {
    return true;
  }
  return channel.permissionsFor(me)?.has('SendMessages') ?? false;
}

function resolveWelcomeChannel(guild: Guild): TextChannel | null {
  if (guild.systemChannel && canSendInChannel(guild, guild.systemChannel)) {
    return guild.systemChannel;
  }

  return (
    guild.channels.cache.find(
      (channel): channel is TextChannel =>
        channel.type === ChannelType.GuildText && canSendInChannel(guild, channel),
    ) ?? null
  );
}

export async function handleGuildCreate(guild: Guild) {
  try {
    logger.info({ guildId: guild.id, guildName: guild.name }, 'Sage joined a new guild');

    const channel = resolveWelcomeChannel(guild);
    if (!channel) {
      logger.warn({ guildId: guild.id }, 'No suitable channel found for welcome message');
      return;
    }

    await channel.send(getWelcomeMessage());
    logger.info({ guildId: guild.id, channelId: channel.id }, 'Proactive welcome message sent');
  } catch (err) {
    logger.error({ err, guildId: guild.id }, 'GuildCreate handler failed');
  }
}

export function registerGuildCreateHandler(client: Client) {
  const g = globalThis as unknown as { [key: symbol]: boolean };
  if (g[registrationKey]) {
    return;
  }
  g[registrationKey] = true;

  client.on(Events.GuildCreate, handleGuildCreate);
  logger.info({ count: client.listenerCount(Events.GuildCreate) }, 'GuildCreate handler registered');
}
