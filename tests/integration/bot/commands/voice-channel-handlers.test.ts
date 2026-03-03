import type { ChatInputCommandInteraction, GuildMember, VoiceChannel } from 'discord.js';
import { ChannelType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChatInputCommandInteraction } from '../../../testkit/discord';

const { joinChannelMock, getConnectionMock, leaveChannelMock, getInstanceMock } = vi.hoisted(() => ({
  joinChannelMock: vi.fn(),
  getConnectionMock: vi.fn(),
  leaveChannelMock: vi.fn(),
  getInstanceMock: vi.fn(),
}));

vi.mock('@/core/voice/voiceManager', () => ({
  VoiceManager: {
    getInstance: getInstanceMock,
  },
}));

import { handleJoinCommand } from '@/bot/commands/voice-channel-handlers';

describe('voice channel command handlers', () => {
  const defaultUser = { id: 'user-1' } as unknown as ChatInputCommandInteraction['user'];

  beforeEach(() => {
    vi.clearAllMocks();
    getInstanceMock.mockReturnValue({
      joinChannel: joinChannelMock,
      getConnection: getConnectionMock,
      leaveChannel: leaveChannelMock,
    });
  });

  it('fetches guild member details when interaction member is uncached', async () => {
    const voiceChannel = {
      id: 'voice-1',
      name: 'General',
      type: ChannelType.GuildVoice,
    } as unknown as VoiceChannel;
    const fetchedMember = { voice: { channel: voiceChannel } } as unknown as GuildMember;
    const fetchMember = vi.fn().mockResolvedValue(fetchedMember);

    const reply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = makeChatInputCommandInteraction({
      commandName: 'join',
      guildId: 'guild-1',
      guild: { members: { fetch: fetchMember } } as unknown as ChatInputCommandInteraction['guild'],
      member: { user: { id: 'user-1' } } as unknown as ChatInputCommandInteraction['member'],
      user: defaultUser,
      reply: reply as unknown as ChatInputCommandInteraction['reply'],
      deferReply: deferReply as unknown as ChatInputCommandInteraction['deferReply'],
      editReply: editReply as unknown as ChatInputCommandInteraction['editReply'],
    });

    await handleJoinCommand(interaction);

    expect(fetchMember).toHaveBeenCalledWith('user-1');
    expect(joinChannelMock).toHaveBeenCalledWith({ channel: voiceChannel, initiatedByUserId: 'user-1' });
    expect(deferReply).toHaveBeenCalledTimes(1);
    expect(editReply).toHaveBeenCalledWith('Joined General!');
    expect(reply).not.toHaveBeenCalled();
  });

  it('returns a user-facing error when guild member resolution fails', async () => {
    const fetchMember = vi.fn().mockRejectedValue(new Error('member fetch failed'));
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = makeChatInputCommandInteraction({
      commandName: 'join',
      guildId: 'guild-1',
      guild: { members: { fetch: fetchMember } } as unknown as ChatInputCommandInteraction['guild'],
      member: { user: { id: 'user-1' } } as unknown as ChatInputCommandInteraction['member'],
      user: defaultUser,
      reply: reply as unknown as ChatInputCommandInteraction['reply'],
    });

    await handleJoinCommand(interaction);

    expect(reply).toHaveBeenCalledWith({
      content: 'Could not resolve your server member state. Please try again.',
      ephemeral: true,
    });
    expect(joinChannelMock).not.toHaveBeenCalled();
  });

  it('falls back to a safe failure response when join fails after defer', async () => {
    const voiceChannel = {
      id: 'voice-1',
      name: 'General',
      type: ChannelType.GuildVoice,
    } as unknown as VoiceChannel;
    const fetchedMember = { voice: { channel: voiceChannel } } as unknown as GuildMember;
    const fetchMember = vi.fn().mockResolvedValue(fetchedMember);
    joinChannelMock.mockRejectedValue(new Error('join failed'));

    const reply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = makeChatInputCommandInteraction({
      commandName: 'join',
      guildId: 'guild-1',
      guild: { members: { fetch: fetchMember } } as unknown as ChatInputCommandInteraction['guild'],
      member: { user: { id: 'user-1' } } as unknown as ChatInputCommandInteraction['member'],
      user: defaultUser,
      reply: reply as unknown as ChatInputCommandInteraction['reply'],
      editReply: editReply as unknown as ChatInputCommandInteraction['editReply'],
    });
    const deferReply = vi.fn().mockImplementation(async () => {
      interaction.deferred = true;
    });
    interaction.deferReply = deferReply as unknown as ChatInputCommandInteraction['deferReply'];

    await handleJoinCommand(interaction);

    expect(editReply).toHaveBeenCalledWith(
      'Failed to join the voice channel. Please check my permissions.',
    );
    expect(reply).not.toHaveBeenCalled();
  });
});
