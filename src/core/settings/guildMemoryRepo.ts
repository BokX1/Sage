/**
 * @module src/core/settings/guildMemoryRepo
 * @description Defines the guild memory repo module.
 */
import { prisma } from '../../core/db/prisma-client';

const CACHE_TTL_MS = 30_000;

/**
 * Represents the GuildMemoryRecord contract.
 */
export interface GuildMemoryRecord {
  guildId: string;
  memoryText: string;
  version: number;
  updatedByAdminId: string | null;
  updatedAt: Date;
  createdAt: Date;
}

type CacheEntry = {
  value: GuildMemoryRecord | null;
  expiresAt: number;
};

const guildMemoryCache = new Map<string, CacheEntry>();

function cacheValue(guildId: string, value: GuildMemoryRecord | null): void {
  guildMemoryCache.set(guildId, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function readCachedValue(guildId: string): GuildMemoryRecord | null | undefined {
  const entry = guildMemoryCache.get(guildId);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    guildMemoryCache.delete(guildId);
    return undefined;
  }

  return entry.value;
}

function normalizeMemoryText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

/**
 * Runs getGuildMemoryRecord.
 *
 * @param guildId - Describes the guildId input.
 * @returns Returns the function result.
 */
export async function getGuildMemoryRecord(guildId: string): Promise<GuildMemoryRecord | null> {
  const cached = readCachedValue(guildId);
  if (cached !== undefined) {
    return cached;
  }

  const row = await prisma.guildMemory.findUnique({
    where: { guildId },
  });

  const record = row
    ? {
      guildId: row.guildId,
      memoryText: row.memoryText,
      version: row.version,
      updatedByAdminId: row.updatedByAdminId,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    }
    : null;

  cacheValue(guildId, record);
  return record;
}

/**
 * Runs getGuildMemoryText.
 *
 * @param guildId - Describes the guildId input.
 * @returns Returns the function result.
 */
export async function getGuildMemoryText(guildId: string): Promise<string | null> {
  const record = await getGuildMemoryRecord(guildId);
  return record?.memoryText ?? null;
}

/**
 * Runs upsertGuildMemory.
 *
 * @param params - Describes the params input.
 * @returns Returns the function result.
 */
export async function upsertGuildMemory(params: {
  guildId: string;
  memoryText: string;
  adminId: string;
}): Promise<GuildMemoryRecord> {
  const normalizedMemoryText = normalizeMemoryText(params.memoryText);
  if (!normalizedMemoryText) {
    throw new Error('Guild memory text cannot be empty.');
  }

  const record = await prisma.$transaction(async (tx) => {
    const existing = await tx.guildMemory.findUnique({
      where: { guildId: params.guildId },
    });

    if (existing) {
      await tx.guildMemoryArchive.create({
        data: {
          guildId: existing.guildId,
          version: existing.version,
          memoryText: existing.memoryText,
          updatedByAdminId: existing.updatedByAdminId,
        },
      });
    }

    return tx.guildMemory.upsert({
      where: { guildId: params.guildId },
      create: {
        guildId: params.guildId,
        memoryText: normalizedMemoryText,
        version: 1,
        updatedByAdminId: params.adminId,
      },
      update: {
        memoryText: normalizedMemoryText,
        version: (existing?.version ?? 0) + 1,
        updatedByAdminId: params.adminId,
      },
    });
  });

  const normalized: GuildMemoryRecord = {
    guildId: record.guildId,
    memoryText: record.memoryText,
    version: record.version,
    updatedByAdminId: record.updatedByAdminId,
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
  };
  cacheValue(params.guildId, normalized);
  return normalized;
}

/**
 * Runs clearGuildMemory.
 *
 * @param params - Describes the params input.
 * @returns Returns the function result.
 */
export async function clearGuildMemory(params: {
  guildId: string;
  adminId: string;
}): Promise<boolean> {
  const deleted = await prisma.$transaction(async (tx) => {
    const existing = await tx.guildMemory.findUnique({
      where: { guildId: params.guildId },
    });
    if (!existing) {
      return false;
    }

    await tx.guildMemoryArchive.create({
      data: {
        guildId: existing.guildId,
        version: existing.version,
        memoryText: existing.memoryText,
        updatedByAdminId: params.adminId,
      },
    });

    await tx.guildMemory.delete({
      where: { guildId: params.guildId },
    });
    return true;
  });

  guildMemoryCache.delete(params.guildId);
  return deleted;
}

/**
 * Runs __clearGuildMemoryCacheForTests.
 *
 * @returns Returns the function result.
 */
export function __clearGuildMemoryCacheForTests(): void {
  guildMemoryCache.clear();
}
