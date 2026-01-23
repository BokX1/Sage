import { Events, Guild, TextChannel } from 'discord.js';
import { logger } from '../../utils/logger';
import { getWelcomeMessage } from './welcomeMessage';

/**
 * Handle Sage joining a new guild.
 * Sends a proactive welcome message to the system channel or first available text channel.
 */
export async function handleGuildCreate(guild: Guild) {
    try {
        logger.info({ guildId: guild.id, guildName: guild.name }, 'Sage joined a new guild');

        // Try to find the best channel to send the welcome message
        const channel =
            guild.systemChannel ||
            guild.channels.cache.find(
                (ch) =>
                    ch.isTextBased() &&
                    !ch.isVoiceBased() &&
                    ch.permissionsFor(guild.members.me!)?.has('SendMessages'),
            );

        if (channel && 'send' in channel) {
            await (channel as TextChannel).send(getWelcomeMessage());
            logger.info({ guildId: guild.id, channelId: channel.id }, 'Proactive welcome message sent');
        } else {
            logger.warn({ guildId: guild.id }, 'No suitable channel found for welcome message');
        }
    } catch (err) {
        logger.error({ err, guildId: guild.id }, 'GuildCreate handler failed');
    }
}

export function registerGuildCreateHandler(client: any) {
    client.on(Events.GuildCreate, handleGuildCreate);
    logger.info('GuildCreate handler registered');
}
