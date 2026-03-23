import { PermissionsBitField } from 'discord.js';

type PermissionSource = PermissionsBitField | string | bigint | null | undefined;
type GuildAdminInteractionLike = {
  member?: unknown;
  inGuild: () => boolean;
};
type GuildMemberLike = {
  permissions?: PermissionSource;
  user?: {
    id?: string;
  } | null;
  id?: string;
  guild?: {
    ownerId?: string;
  } | null;
};

export type DiscordAuthorityTier = 'member' | 'moderator' | 'admin' | 'owner';

const AUTHORITY_RANK: Record<DiscordAuthorityTier, number> = {
  member: 0,
  moderator: 1,
  admin: 2,
  owner: 3,
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

function readMemberUserId(member: GuildMemberLike): string | null {
  const userId = member.user?.id?.trim() ?? member.id?.trim() ?? '';
  return userId.length > 0 ? userId : null;
}

export function resolveAuthorityTierFromMember(
  member: unknown,
  guildOwnerId?: string | null,
): DiscordAuthorityTier {
  if (!member || typeof member !== 'object' || !('permissions' in member)) {
    return 'member';
  }

  const candidate = member as GuildMemberLike;
  const source = candidate.permissions;
  const effectiveGuildOwnerId = guildOwnerId?.trim() || candidate.guild?.ownerId?.trim() || null;
  const memberUserId = readMemberUserId(candidate);
  if (effectiveGuildOwnerId && memberUserId && effectiveGuildOwnerId === memberUserId) {
    return 'owner';
  }
  if (hasAdminPermissions(source)) {
    return 'admin';
  }
  if (hasModerationPermissions(source)) {
    return 'moderator';
  }
  return 'member';
}

export function hasAuthorityAtLeast(
  authority: DiscordAuthorityTier | null | undefined,
  required: DiscordAuthorityTier,
): boolean {
  const actual = authority ?? 'member';
  return AUTHORITY_RANK[actual] >= AUTHORITY_RANK[required];
}

export function isOwnerFromMember(member: unknown, guildOwnerId?: string | null): boolean {
  return resolveAuthorityTierFromMember(member, guildOwnerId) === 'owner';
}

export function isAdminFromMember(member: unknown): boolean {
  return hasAuthorityAtLeast(resolveAuthorityTierFromMember(member), 'admin');
}

export function isModeratorFromMember(member: unknown): boolean {
  return hasAuthorityAtLeast(resolveAuthorityTierFromMember(member), 'moderator');
}

export function isAdminInteraction(interaction: GuildAdminInteractionLike): boolean {
  if (!interaction.inGuild()) {
    return false;
  }

  return hasAuthorityAtLeast(resolveAuthorityTierFromMember(interaction.member), 'admin');
}
