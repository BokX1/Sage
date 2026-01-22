import { prisma } from '../../db/client';

export type VoiceSession = {
  id: string;
  guildId: string;
  channelId: string;
  userId: string;
  displayName?: string | null;
  startedAt: Date;
  endedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PrismaVoiceSessionClient = {
  create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
  findFirst: (args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
  }) => Promise<Record<string, unknown> | null>;
  update: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  updateMany: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<{ count: number }>;
  findMany: (args: { where: Record<string, unknown> }) => Promise<Record<string, unknown>[]>;
};

function getVoiceSessionClient(): PrismaVoiceSessionClient {
  return (prisma as unknown as { voiceSession: PrismaVoiceSessionClient }).voiceSession;
}

export async function startSession(params: {
  guildId: string;
  channelId: string;
  userId: string;
  displayName?: string;
  startedAt: Date;
}): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const client = (tx as unknown as { voiceSession: PrismaVoiceSessionClient }).voiceSession;
      const openSession = await client.findFirst({
        where: {
          guildId: params.guildId,
          userId: params.userId,
          endedAt: null,
        },
        orderBy: { startedAt: 'desc' },
      });

      if (openSession) {
        const sameChannel = openSession.channelId === params.channelId;
        const openStartedAt = openSession.startedAt as Date;
        if (sameChannel && openStartedAt <= params.startedAt) {
          return;
        }

        await client.update({
          where: { id: openSession.id as string },
          data: { endedAt: params.startedAt },
        });
      }

      await client.create({
        data: {
          guildId: params.guildId,
          channelId: params.channelId,
          userId: params.userId,
          displayName: params.displayName ?? null,
          startedAt: params.startedAt,
        },
      });
    },
    { isolationLevel: 'Serializable' },
  );
}

export async function endOpenSession(params: {
  guildId: string;
  userId: string;
  endedAt: Date;
}): Promise<void> {
  const client = getVoiceSessionClient();
  await client.updateMany({
    where: {
      guildId: params.guildId,
      userId: params.userId,
      endedAt: null,
    },
    data: { endedAt: params.endedAt },
  });
}

export async function listOpenSessions(params: { guildId: string }): Promise<VoiceSession[]> {
  const client = getVoiceSessionClient();
  const rows = await client.findMany({
    where: {
      guildId: params.guildId,
      endedAt: null,
    },
  });

  return rows.map((row) => ({
    id: row.id as string,
    guildId: row.guildId as string,
    channelId: row.channelId as string,
    userId: row.userId as string,
    displayName: row.displayName as string | null,
    startedAt: row.startedAt as Date,
    endedAt: row.endedAt as Date | null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  }));
}

export async function getUserSessionsInRange(params: {
  guildId: string;
  userId: string;
  start: Date;
  end: Date;
}): Promise<VoiceSession[]> {
  const client = getVoiceSessionClient();
  const rows = await client.findMany({
    where: {
      guildId: params.guildId,
      userId: params.userId,
      startedAt: { lt: params.end },
      OR: [{ endedAt: null }, { endedAt: { gte: params.start } }],
    },
  });

  return rows.map((row) => ({
    id: row.id as string,
    guildId: row.guildId as string,
    channelId: row.channelId as string,
    userId: row.userId as string,
    displayName: row.displayName as string | null,
    startedAt: row.startedAt as Date,
    endedAt: row.endedAt as Date | null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  }));
}
