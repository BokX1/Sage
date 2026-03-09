import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db/prisma-client';

export interface DiscordInteractionSessionRecord {
  id: string;
  guildId: string;
  channelId: string;
  createdByUserId: string;
  kind: string;
  payloadJson: unknown;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(value: {
  id: string;
  guildId: string;
  channelId: string;
  createdByUserId: string;
  kind: string;
  payloadJson: unknown;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): DiscordInteractionSessionRecord {
  return {
    id: value.id,
    guildId: value.guildId,
    channelId: value.channelId,
    createdByUserId: value.createdByUserId,
    kind: value.kind,
    payloadJson: value.payloadJson,
    expiresAt: value.expiresAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export async function createDiscordInteractionSession(params: {
  guildId: string;
  channelId: string;
  createdByUserId: string;
  kind: string;
  payloadJson: unknown;
  expiresAt: Date;
}): Promise<DiscordInteractionSessionRecord> {
  const created = await prisma.discordInteractionSession.create({
    data: {
      guildId: params.guildId,
      channelId: params.channelId,
      createdByUserId: params.createdByUserId,
      kind: params.kind,
      payloadJson: params.payloadJson as Prisma.InputJsonValue,
      expiresAt: params.expiresAt,
    },
  });

  return toRecord(created);
}

export async function getDiscordInteractionSessionById(
  id: string,
): Promise<DiscordInteractionSessionRecord | null> {
  const row = await prisma.discordInteractionSession.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}
