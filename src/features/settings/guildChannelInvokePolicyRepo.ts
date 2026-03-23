import { prisma } from '../../platform/db/prisma-client';

export const DISCORD_THREAD_AUTO_ARCHIVE_MINUTES = [60, 1440, 4320, 10080] as const;
export type DiscordThreadAutoArchiveMinutes =
  (typeof DISCORD_THREAD_AUTO_ARCHIVE_MINUTES)[number];

export interface GuildChannelInvokePolicyRecord {
  id: string;
  guildId: string;
  channelId: string;
  mode: 'public_from_message';
  autoArchiveDurationMinutes: DiscordThreadAutoArchiveMinutes | null;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

type GuildChannelInvokePolicyRow = {
  id: string;
  guildId: string;
  channelId: string;
  mode: string;
  autoArchiveDurationMinutes: number | null;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(value: GuildChannelInvokePolicyRow): GuildChannelInvokePolicyRecord {
  return {
    id: value.id,
    guildId: value.guildId,
    channelId: value.channelId,
    mode: 'public_from_message',
    autoArchiveDurationMinutes:
      (value.autoArchiveDurationMinutes as DiscordThreadAutoArchiveMinutes | null) ?? null,
    createdByUserId: value.createdByUserId,
    updatedByUserId: value.updatedByUserId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function isSupportedThreadAutoArchiveDuration(
  value: number | null | undefined,
): value is DiscordThreadAutoArchiveMinutes {
  return value !== null && value !== undefined && DISCORD_THREAD_AUTO_ARCHIVE_MINUTES.includes(value as DiscordThreadAutoArchiveMinutes);
}

export async function getGuildChannelInvokePolicy(
  guildId: string,
  channelId: string,
): Promise<GuildChannelInvokePolicyRecord | null> {
  const delegate = (prisma as unknown as {
    guildChannelInvokePolicy: {
      findUnique: (args: unknown) => Promise<GuildChannelInvokePolicyRow | null>;
      findMany: (args: unknown) => Promise<GuildChannelInvokePolicyRow[]>;
      upsert: (args: unknown) => Promise<GuildChannelInvokePolicyRow>;
      deleteMany: (args: unknown) => Promise<unknown>;
    };
  }).guildChannelInvokePolicy;
  const row = await delegate.findUnique({
    where: {
      guildId_channelId: {
        guildId,
        channelId,
      },
    },
  });
  return row ? toRecord(row) : null;
}

export async function listGuildChannelInvokePolicies(
  guildId: string,
): Promise<GuildChannelInvokePolicyRecord[]> {
  const delegate = (prisma as unknown as {
    guildChannelInvokePolicy: {
      findMany: (args: unknown) => Promise<GuildChannelInvokePolicyRow[]>;
    };
  }).guildChannelInvokePolicy;
  const rows = await delegate.findMany({
    where: { guildId },
    orderBy: [{ updatedAt: 'desc' }, { channelId: 'asc' }],
  });
  return rows.map(toRecord);
}

export async function upsertGuildChannelInvokePolicy(params: {
  guildId: string;
  channelId: string;
  autoArchiveDurationMinutes?: DiscordThreadAutoArchiveMinutes | null;
  updatedByUserId: string;
}): Promise<GuildChannelInvokePolicyRecord> {
  const delegate = (prisma as unknown as {
    guildChannelInvokePolicy: {
      upsert: (args: unknown) => Promise<GuildChannelInvokePolicyRow>;
    };
  }).guildChannelInvokePolicy;
  const row = await delegate.upsert({
    where: {
      guildId_channelId: {
        guildId: params.guildId,
        channelId: params.channelId,
      },
    },
    create: {
      guildId: params.guildId,
      channelId: params.channelId,
      mode: 'public_from_message',
      autoArchiveDurationMinutes: params.autoArchiveDurationMinutes ?? null,
      createdByUserId: params.updatedByUserId,
      updatedByUserId: params.updatedByUserId,
    },
    update: {
      mode: 'public_from_message',
      autoArchiveDurationMinutes: params.autoArchiveDurationMinutes ?? null,
      updatedByUserId: params.updatedByUserId,
    },
  });

  return toRecord(row);
}

export async function deleteGuildChannelInvokePolicy(
  guildId: string,
  channelId: string,
): Promise<void> {
  const delegate = (prisma as unknown as {
    guildChannelInvokePolicy: {
      deleteMany: (args: unknown) => Promise<unknown>;
    };
  }).guildChannelInvokePolicy;
  await delegate.deleteMany({
    where: {
      guildId,
      channelId,
    },
  });
}
