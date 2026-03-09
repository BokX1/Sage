import type { ChatInputCommandInteraction } from 'discord.js';
import { PermissionsBitField } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChatInputCommandInteraction } from '../../../../testkit/discord';

const configMock = vi.hoisted(() => ({
  NODE_ENV: 'test',
}));

vi.mock('@/platform/config/env', () => ({
  config: configMock,
}));
import { handleAdminStats, isAdmin } from '@/app/discord/handlers/sage-command-handlers';

function createBaseInteraction(overrides: Record<string, unknown> = {}): ChatInputCommandInteraction {
  const base = makeChatInputCommandInteraction({
    guildId: 'guild-1',
    inGuild: (() => true) as unknown as ChatInputCommandInteraction['inGuild'],
    user: { id: '111' } as unknown as ChatInputCommandInteraction['user'],
    member: null as unknown as ChatInputCommandInteraction['member'],
    options: {
      getString: vi.fn(() => null),
      getInteger: vi.fn(() => null),
      getSubcommand: vi.fn(() => 'trace'),
      getSubcommandGroup: vi.fn(() => 'admin'),
    } as unknown as ChatInputCommandInteraction['options'],
  }) as unknown as Record<string, unknown>;

  return {
    ...base,
    ...overrides,
  } as unknown as ChatInputCommandInteraction;
}

describe('sage command handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats ManageGuild permission as admin', () => {
    const interaction = createBaseInteraction({
      member: {
        permissions: new PermissionsBitField(PermissionsBitField.Flags.ManageGuild),
      } as unknown as ChatInputCommandInteraction['member'],
    });
    const nonAdminInteraction = createBaseInteraction({
      member: {
        permissions: new PermissionsBitField(PermissionsBitField.Flags.ViewChannel),
      } as unknown as ChatInputCommandInteraction['member'],
    });

    expect({
      manageGuild: isAdmin(interaction),
      viewOnly: isAdmin(nonAdminInteraction),
    }).toEqual({
      manageGuild: true,
      viewOnly: false,
    });
  });

  it('treats Administrator permission as admin', () => {
    const interaction = createBaseInteraction({
      member: {
        permissions: new PermissionsBitField(PermissionsBitField.Flags.Administrator),
      } as unknown as ChatInputCommandInteraction['member'],
    });
    const nonAdminInteraction = createBaseInteraction({
      member: {
        permissions: new PermissionsBitField(PermissionsBitField.Flags.SendMessages),
      } as unknown as ChatInputCommandInteraction['member'],
    });

    expect({
      administrator: isAdmin(interaction),
      nonAdmin: isAdmin(nonAdminInteraction),
    }).toEqual({
      administrator: true,
      nonAdmin: false,
    });
  });

  it('uses editReply for admin denial when interaction was already deferred', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = createBaseInteraction({
      deferred: true,
      reply: reply as unknown as ChatInputCommandInteraction['reply'],
      editReply: editReply as unknown as ChatInputCommandInteraction['editReply'],
    });

    await handleAdminStats(interaction);

    expect(editReply).toHaveBeenCalledWith({ content: '❌ Admin only.' });
    expect(reply).not.toHaveBeenCalled();
  });
});
