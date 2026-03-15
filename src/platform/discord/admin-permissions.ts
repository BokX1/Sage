import { PermissionsBitField } from 'discord.js';

type PermissionSource = PermissionsBitField | string | bigint | null | undefined;
type GuildAdminInteractionLike = {
  member?: unknown;
  inGuild: () => boolean;
};

function toPermissionsBitField(source: PermissionSource): PermissionsBitField | null {
  if (source === null || source === undefined) {
    return null;
  }

  return source instanceof PermissionsBitField
    ? source
    : new PermissionsBitField(typeof source === 'string' ? BigInt(source) : source);
}

export function hasGovernanceAdminPermissions(source: PermissionSource): boolean {
  const permissions = toPermissionsBitField(source);
  if (!permissions) {
    return false;
  }

  return (
    permissions.has(PermissionsBitField.Flags.Administrator) ||
    permissions.has(PermissionsBitField.Flags.ManageGuild)
  );
}

export function hasAdminPermissions(source: PermissionSource): boolean {
  return hasGovernanceAdminPermissions(source);
}

export function hasModerationPermissions(source: PermissionSource): boolean {
  const permissions = toPermissionsBitField(source);
  if (!permissions) {
    return false;
  }

  return (
    permissions.has(PermissionsBitField.Flags.Administrator) ||
    permissions.has(PermissionsBitField.Flags.ManageGuild) ||
    permissions.has(PermissionsBitField.Flags.ManageMessages) ||
    permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
    permissions.has(PermissionsBitField.Flags.KickMembers) ||
    permissions.has(PermissionsBitField.Flags.BanMembers)
  );
}

export function isAdminFromMember(member: unknown): boolean {
  if (!member || typeof member !== 'object' || !('permissions' in member)) {
    return false;
  }

  const source = (member as { permissions?: PermissionSource }).permissions;
  return hasAdminPermissions(source);
}

export function isModeratorFromMember(member: unknown): boolean {
  if (!member || typeof member !== 'object' || !('permissions' in member)) {
    return false;
  }

  const source = (member as { permissions?: PermissionSource }).permissions;
  return hasModerationPermissions(source);
}

export function isAdminInteraction(interaction: GuildAdminInteractionLike): boolean {
  if (!interaction.inGuild()) {
    return false;
  }

  return isAdminFromMember(interaction.member);
}
