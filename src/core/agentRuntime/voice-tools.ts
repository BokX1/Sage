import { z } from 'zod';
import { ToolDefinition } from '../agentRuntime/toolRegistry';
import { client } from '../../bot/client';
import { VoiceManager } from '../voice/voiceManager';
import { logger } from '../../core/utils/logger';

/**
 * Voice tool definitions are kept for compatibility, but are intentionally
 * not registered at bootstrap. Voice join/leave is command-only.
 */
export const joinVoiceTool: ToolDefinition = {
  name: 'join_voice_channel',
  description: 'Join the user\'s current voice channel. Use this when the user asks you to join voice, hop in vc, or speak to them.',
  schema: z.object({}),
  execute: async (_args, ctx) => {
    const { userId, channelId } = ctx;

    // We need to find the guild from the channelId or context. 
    // ToolExecutionContext currently doesn't explicitly pass guildId, 
    // but we can derive it from the discord client if we have the channelId.

    const textChannel = client.channels.cache.get(channelId);
    if (!textChannel || !('guild' in textChannel)) {
      return "I can't join voice from a DM or unknown channel.";
    }

    const guild = textChannel.guild;
    const member = await guild.members.fetch(userId).catch(() => null);

    if (!member || !member.voice.channel) {
      return "You need to be in a voice channel first!";
    }

    if (!member.voice.channel.joinable) {
      return "I don't have permission to join your voice channel.";
    }

    try {
      const voiceManager = VoiceManager.getInstance();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await voiceManager.joinChannel(member.voice.channel as any);
      return `Successfully joined ${member.voice.channel.name}. I am now listening and ready to speak.`;
    } catch (error) {
      logger.error({ error, guildId: guild.id }, 'Failed to join voice via tool');
      return "I encountered an error trying to join the voice channel.";
    }
  },
};

export const leaveVoiceTool: ToolDefinition = {
  name: 'leave_voice_channel',
  description: 'Leave the current voice channel. Use this when the user asks you to leave, disconnect, or stop speaking.',
  schema: z.object({}),
  execute: async (_args, ctx) => {
    const { channelId } = ctx;
    const textChannel = client.channels.cache.get(channelId);
    if (!textChannel || !('guild' in textChannel)) {
      return "Failed to determine guild context.";
    }

    const guildId = textChannel.guild.id;
    const voiceManager = VoiceManager.getInstance();

    // Check if connected
    if (!voiceManager.getConnection(guildId)) {
      return "I'm not currently in a voice channel.";
    }

    voiceManager.leaveChannel(guildId);
    return "Disconnected from voice channel.";
  },
};
