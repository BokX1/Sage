import { prisma } from '../../platform/db/prisma-client';

const CACHE_TTL_MS = 30_000;

export interface ServerInstructionsRecord {
  guildId: string;
  instructionsText: string;
  version: number;
  updatedByAdminId: string | null;
  updatedAt: Date;
  createdAt: Date;
}

type CacheEntry = {
  value: ServerInstructionsRecord | null;
  expiresAt: number;
};

const serverInstructionsCache = new Map<string, CacheEntry>();

function cacheValue(guildId: string, value: ServerInstructionsRecord | null): void {
  serverInstructionsCache.set(guildId, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function readCachedValue(guildId: string): ServerInstructionsRecord | null | undefined {
  const entry = serverInstructionsCache.get(guildId);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    serverInstructionsCache.delete(guildId);
    return undefined;
  }

  return entry.value;
}

function normalizeInstructionsText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

export async function getServerInstructionsRecord(guildId: string): Promise<ServerInstructionsRecord | null> {
  const cached = readCachedValue(guildId);
  if (cached !== undefined) {
    return cached;
  }

  const row = await prisma.serverInstructions.findUnique({
    where: { guildId },
  });

  const record = row
    ? {
        guildId: row.guildId,
        instructionsText: row.instructionsText,
        version: row.version,
        updatedByAdminId: row.updatedByAdminId,
        updatedAt: row.updatedAt,
        createdAt: row.createdAt,
      }
    : null;

  cacheValue(guildId, record);
  return record;
}

export async function getServerInstructionsText(guildId: string): Promise<string | null> {
  const record = await getServerInstructionsRecord(guildId);
  return record?.instructionsText ?? null;
}

export async function upsertServerInstructions(params: {
  guildId: string;
  instructionsText: string;
  adminId: string;
}): Promise<ServerInstructionsRecord> {
  const normalizedInstructionsText = normalizeInstructionsText(params.instructionsText);
  if (!normalizedInstructionsText) {
    throw new Error('Server instructions text cannot be empty.');
  }

  const record = await prisma.$transaction(async (tx) => {
    const existing = await tx.serverInstructions.findUnique({
      where: { guildId: params.guildId },
    });

    if (existing) {
      await tx.serverInstructionsArchive.create({
        data: {
          guildId: existing.guildId,
          version: existing.version,
          instructionsText: existing.instructionsText,
          updatedByAdminId: existing.updatedByAdminId,
        },
      });
    }

    return tx.serverInstructions.upsert({
      where: { guildId: params.guildId },
      create: {
        guildId: params.guildId,
        instructionsText: normalizedInstructionsText,
        version: 1,
        updatedByAdminId: params.adminId,
      },
      update: {
        instructionsText: normalizedInstructionsText,
        version: (existing?.version ?? 0) + 1,
        updatedByAdminId: params.adminId,
      },
    });
  });

  const normalized: ServerInstructionsRecord = {
    guildId: record.guildId,
    instructionsText: record.instructionsText,
    version: record.version,
    updatedByAdminId: record.updatedByAdminId,
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
  };
  cacheValue(params.guildId, normalized);
  return normalized;
}

export async function clearServerInstructions(params: {
  guildId: string;
  adminId: string;
}): Promise<boolean> {
  const deleted = await prisma.$transaction(async (tx) => {
    const existing = await tx.serverInstructions.findUnique({
      where: { guildId: params.guildId },
    });
    if (!existing) {
      return false;
    }

    await tx.serverInstructionsArchive.create({
      data: {
        guildId: existing.guildId,
        version: existing.version,
        instructionsText: existing.instructionsText,
        updatedByAdminId: params.adminId,
      },
    });

    await tx.serverInstructions.delete({
      where: { guildId: params.guildId },
    });
    return true;
  });

  serverInstructionsCache.delete(params.guildId);
  return deleted;
}

export function __clearServerInstructionsCacheForTests(): void {
  serverInstructionsCache.clear();
}
