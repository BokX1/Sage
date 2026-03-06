import { PermissionsBitField } from 'discord.js';

type PermissionSource = PermissionsBitField | string | bigint | null | undefined;

export function hasAdminPermissions(source: PermissionSource): boolean {
  if (source === null || source === undefined) {
    return false;
  }

  const permissions =
    source instanceof PermissionsBitField
      ? source
      : new PermissionsBitField(typeof source === 'string' ? BigInt(source) : source);

  return (
    permissions.has(PermissionsBitField.Flags.Administrator) ||
    permissions.has(PermissionsBitField.Flags.ManageGuild)
  );
}

export function isAdminFromMember(member: unknown): boolean {
  if (!member || typeof member !== 'object' || !('permissions' in member)) {
    return false;
  }

  const source = (member as { permissions?: PermissionSource }).permissions;
  return hasAdminPermissions(source);
}
