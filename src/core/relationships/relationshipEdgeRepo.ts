import { prisma } from '../../core/db/prisma-client';

export type RelationshipEdge = {
  id: string;
  guildId: string;
  userA: string;
  userB: string;
  weight: number;
  confidence: number;
  featuresJson: RelationshipFeatures;
  manualOverride: number | null;
  updatedAt: Date;
  createdAt: Date;
};

export type RelationshipFeatures = {
  mentions: { count: number; lastAt: number };
  replies: { count: number; lastAt: number; reciprocalCount?: number };
  voice: { overlapMs: number; lastAt: number };
  meta: { lastComputedAt: number };
};

type PrismaRelationshipEdgeClient = {
  create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
  findUnique: (args: { where: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
  update: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  upsert: (args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  findMany: (args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
    take?: number;
  }) => Promise<Record<string, unknown>[]>;
};

function getRelationshipEdgeClient(): PrismaRelationshipEdgeClient {
  return (prisma as unknown as { relationshipEdge: PrismaRelationshipEdgeClient }).relationshipEdge;
}

function toRelationshipEdge(row: Record<string, unknown>): RelationshipEdge {
  return {
    id: row.id as string,
    guildId: row.guildId as string,
    userA: row.userA as string,
    userB: row.userB as string,
    weight: row.weight as number,
    confidence: row.confidence as number,
    featuresJson: row.featuresJson as RelationshipFeatures,
    manualOverride: (row.manualOverride as number | null) ?? null,
    updatedAt: row.updatedAt as Date,
    createdAt: row.createdAt as Date,
  };
}

export async function upsertEdge(params: {
  guildId: string;
  userA: string;
  userB: string;
  weight: number;
  confidence: number;
  featuresJson: RelationshipFeatures;
  manualOverride?: number | null;
}): Promise<void> {
  const client = getRelationshipEdgeClient();
  await client.upsert({
    where: {
      guildId_userA_userB: {
        guildId: params.guildId,
        userA: params.userA,
        userB: params.userB,
      },
    },
    create: {
      guildId: params.guildId,
      userA: params.userA,
      userB: params.userB,
      weight: params.weight,
      confidence: params.confidence,
      featuresJson: params.featuresJson,
      manualOverride: params.manualOverride ?? null,
    },
    update: {
      weight: params.weight,
      confidence: params.confidence,
      featuresJson: params.featuresJson,
      manualOverride: params.manualOverride ?? null,
    },
  });
}

export async function findEdge(params: {
  guildId: string;
  userA: string;
  userB: string;
}): Promise<RelationshipEdge | null> {
  const client = getRelationshipEdgeClient();
  const row = await client.findUnique({
    where: {
      guildId_userA_userB: {
        guildId: params.guildId,
        userA: params.userA,
        userB: params.userB,
      },
    },
  });

  return row ? toRelationshipEdge(row) : null;
}

export async function findTopEdges(params: {
  guildId: string;
  limit: number;
  minWeight?: number;
}): Promise<RelationshipEdge[]> {
  const client = getRelationshipEdgeClient();
  const rows = await client.findMany({
    where: {
      guildId: params.guildId,
      weight: params.minWeight !== undefined ? { gte: params.minWeight } : undefined,
    },
    orderBy: { weight: 'desc' },
    take: params.limit,
  });

  return rows.map(toRelationshipEdge);
}

export async function findEdgesForUser(params: {
  guildId: string;
  userId: string;
  limit: number;
}): Promise<RelationshipEdge[]> {
  const client = getRelationshipEdgeClient();
  const rows = await client.findMany({
    where: {
      guildId: params.guildId,
      OR: [{ userA: params.userId }, { userB: params.userId }],
    },
    orderBy: { weight: 'desc' },
    take: params.limit,
  });

  return rows.map(toRelationshipEdge);
}

/**
 * Find multiple edges in a single batch query.
 * Reduces N+1 queries when updating multiple relationships at once.
 */
export async function findEdgesBatch(params: {
  guildId: string;
  pairs: Array<{ userA: string; userB: string }>;
}): Promise<Map<string, RelationshipEdge>> {
  if (params.pairs.length === 0) {
    return new Map();
  }

  const client = getRelationshipEdgeClient();
  const rows = await client.findMany({
    where: {
      guildId: params.guildId,
      OR: params.pairs.map((p) => ({
        userA: p.userA,
        userB: p.userB,
      })),
    },
  });

  const result = new Map<string, RelationshipEdge>();
  for (const row of rows) {
    const edge = toRelationshipEdge(row);
    const key = `${edge.userA}:${edge.userB}`;
    result.set(key, edge);
  }
  return result;
}
