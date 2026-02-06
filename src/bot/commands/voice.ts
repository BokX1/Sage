import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  GuildMember,
  VoiceChannel,
  ChannelType,
} from 'discord.js';
import { VoiceManager } from '../../core/voice/voiceManager';
import { logger } from '../../utils/logger';

/** Voice slash commands available to members in guild channels. */
export const voiceCommands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your current voice channel'),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave the current voice channel'),
];

/**
 * Join the caller's current voice channel using the shared voice manager.
 */
export async function handleJoinCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId || !interaction.member) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  const channel = member.voice.channel;

  if (!channel || channel.type !== ChannelType.GuildVoice) {
    await interaction.reply({
      content: 'You must be in a voice channel to use this command.',
      ephemeral: true,
    });
    return;
  }

  try {
    await interaction.deferReply();
    const voiceManager = VoiceManager.getInstance();
    await voiceManager.joinChannel(channel as VoiceChannel);
    await interaction.editReply(`Joined ${channel.name}!`);
  } catch (error) {
    logger.error({ error, guildId: interaction.guildId }, 'Failed to join voice channel');
    await interaction.editReply('Failed to join the voice channel. Please check my permissions.');
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

    voiceManager.leaveChannel(interaction.guildId);
    await interaction.reply('Left the voice channel.');
  } catch (error) {
    logger.error({ error, guildId: interaction.guildId }, 'Failed to leave voice channel');
    await interaction.reply({
      content: 'An error occurred while trying to leave the voice channel.',
      ephemeral: true,
    });
  }
}
