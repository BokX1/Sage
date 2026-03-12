import { prisma } from '../../platform/db/prisma-client';

const CACHE_TTL_MS = 30_000;

export interface GuildSagePersonaRecord {
  guildId: string;
  instructionsText: string;
  version: number;
  updatedByAdminId: string | null;
  updatedAt: Date;
  createdAt: Date;
}

type CacheEntry = {
  value: GuildSagePersonaRecord | null;
  expiresAt: number;
};

const guildSagePersonaCache = new Map<string, CacheEntry>();

function cacheValue(guildId: string, value: GuildSagePersonaRecord | null): void {
  guildSagePersonaCache.set(guildId, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function readCachedValue(guildId: string): GuildSagePersonaRecord | null | undefined {
  const entry = guildSagePersonaCache.get(guildId);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    guildSagePersonaCache.delete(guildId);
    return undefined;
  }

  return entry.value;
}

function normalizeSagePersonaText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

export async function getGuildSagePersonaRecord(guildId: string): Promise<GuildSagePersonaRecord | null> {
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

export async function getGuildSagePersonaText(guildId: string): Promise<string | null> {
  const record = await getGuildSagePersonaRecord(guildId);
  return record?.instructionsText ?? null;
}

export async function upsertGuildSagePersona(params: {
  guildId: string;
  instructionsText: string;
  adminId: string;
}): Promise<GuildSagePersonaRecord> {
  const normalizedInstructionsText = normalizeSagePersonaText(params.instructionsText);
  if (!normalizedInstructionsText) {
    throw new Error('Sage Persona text cannot be empty.');
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

  const normalized: GuildSagePersonaRecord = {
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

export async function clearGuildSagePersona(params: {
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

  guildSagePersonaCache.delete(params.guildId);
  return deleted;
}

export function __clearGuildSagePersonaCacheForTests(): void {
  guildSagePersonaCache.clear();
}
