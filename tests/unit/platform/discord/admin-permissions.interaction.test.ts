import type { ChatInputCommandInteraction } from 'discord.js';
import { PermissionsBitField } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { makeChatInputCommandInteraction } from '../../../testkit/discord';
import {
  hasModerationPermissions,
  isAdminInteraction,
  isModeratorFromMember,
} from '@/platform/discord/admin-permissions';

function createBaseInteraction(overrides: Record<string, unknown> = {}): ChatInputCommandInteraction {
  const base = makeChatInputCommandInteraction({
    guildId: 'guild-1',
    inGuild: (() => true) as unknown as ChatInputCommandInteraction['inGuild'],
    user: { id: '111' } as unknown as ChatInputCommandInteraction['user'],
    member: null as unknown as ChatInputCommandInteraction['member'],
    options: {
      getString: vi.fn(() => null),
      getInteger: vi.fn(() => null),
      getSubcommand: vi.fn(() => ''),
      getSubcommandGroup: vi.fn(() => null),
    } as unknown as ChatInputCommandInteraction['options'],
  }) as unknown as Record<string, unknown>;

  return {
    ...base,
    ...overrides,
  } as unknown as ChatInputCommandInteraction;
}

describe('admin permission interaction helpers', () => {
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
      manageGuild: isAdminInteraction(interaction),
      viewOnly: isAdminInteraction(nonAdminInteraction),
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
      administrator: isAdminInteraction(interaction),
      nonAdmin: isAdminInteraction(nonAdminInteraction),
    }).toEqual({
      administrator: true,
      nonAdmin: false,
    });
  });

  it('treats ManageMessages permission as moderator but not admin', () => {
    const moderatorMember = {
      permissions: new PermissionsBitField(PermissionsBitField.Flags.ManageMessages),
    } as unknown as ChatInputCommandInteraction['member'];
    const interaction = createBaseInteraction({
      member: moderatorMember,
    });

    expect(isAdminInteraction(interaction)).toBe(false);
    expect(isModeratorFromMember(moderatorMember)).toBe(true);
    expect(
      hasModerationPermissions(
        new PermissionsBitField(PermissionsBitField.Flags.ManageMessages),
      ),
    ).toBe(true);
  });
});
