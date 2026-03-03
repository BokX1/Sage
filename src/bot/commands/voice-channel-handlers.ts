import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  GuildMember,
  VoiceChannel,
  ChannelType,
} from 'discord.js';
import { VoiceManager } from '../../core/voice/voiceManager';
import { logger } from '../../core/utils/logger';
import { config } from '../../config';
import { isLoggingEnabled } from '../../core/settings/guildChannelSettings';

/** Voice slash commands available to members in guild channels. */
export const voiceCommands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your current voice channel (Stage channels are not supported)'),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave the current voice channel'),
];

function isGuildVoiceChannel(channel: GuildMember['voice']['channel']): channel is VoiceChannel {
  return !!channel && channel.type === ChannelType.GuildVoice;
}

async function resolveInteractionMember(
  interaction: ChatInputCommandInteraction,
): Promise<GuildMember | null> {
  if (interaction.member instanceof GuildMember) {
    return interaction.member;
  }

  if (!interaction.guild) {
    return null;
  }

  try {
    return await interaction.guild.members.fetch(interaction.user.id);
  } catch (error) {
    logger.warn(
      { error, guildId: interaction.guildId, userId: interaction.user.id },
      'Failed to resolve interaction member for voice command',
    );
    return null;
  }
}

async function replyJoinFailure(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(content);
    return;
  }

  await interaction.reply({
    content,
    ephemeral: true,
  });
}

/**
 * Join the caller's current voice channel using the shared voice manager.
 */
export async function handleJoinCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const member = await resolveInteractionMember(interaction);
  if (!member) {
    await interaction.reply({
      content: 'Could not resolve your server member state. Please try again.',
      ephemeral: true,
    });
    return;
  }

  const channel = member.voice.channel;

  if (!isGuildVoiceChannel(channel)) {
    await interaction.reply({
      content: 'You must be in a voice channel to use this command. Stage channels are not supported.',
      ephemeral: true,
    });
    return;
  }

  try {
    await interaction.deferReply();
    const voiceManager = VoiceManager.getInstance();
    await voiceManager.joinChannel({ channel, initiatedByUserId: interaction.user.id });

    const sttActive = config.VOICE_STT_ENABLED && isLoggingEnabled(interaction.guildId, channel.id);
    const suffix = sttActive
      ? ' Transcription is enabled (summary-only memory on leave).'
      : '';

    await interaction.editReply(`Joined ${channel.name}!${suffix}`);
  } catch (error) {
    logger.error({ error, guildId: interaction.guildId }, 'Failed to join voice channel');
    try {
      await replyJoinFailure(
        interaction,
        'Failed to join the voice channel. Please check my permissions.',
      );
    } catch (replyError) {
      logger.warn(
        { error: replyError, guildId: interaction.guildId },
        'Failed to send join command failure response',
      );
    }
  }
}

/**
 * Leave the active voice channel for the guild where the command was invoked.
 */
export async function handleLeaveCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  try {
    const voiceManager = VoiceManager.getInstance();
    const connection = voiceManager.getConnection(interaction.guildId);

    if (!connection) {
      await interaction.reply({
        content: 'I am not currently in a voice channel.',
        ephemeral: true,
      });
      return;
    }

    await voiceManager.leaveChannel(interaction.guildId);
    await interaction.reply('Left the voice channel.');
  } catch (error) {
    logger.error({ error, guildId: interaction.guildId }, 'Failed to leave voice channel');
    await interaction.reply({
      content: 'An error occurred while trying to leave the voice channel.',
      ephemeral: true,
    });
  }
}
