import { prisma } from '../../platform/db/prisma-client';
import type { ModerationCaseRecord, ModerationPolicyRecord } from './types';

type ModerationPolicyRow = {
  id: string;
  guildId: string;
  name: string;
  descriptionText: string | null;
  family: string;
  backend: string;
  ownership: string;
  mode: string;
  version: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  externalRuleId: string | null;
  notifyChannelId: string | null;
  policySpecJson: unknown;
  compiledPolicyJson: unknown;
  lastSyncedAt: Date | null;
  lastConflictText: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ModerationCaseRow = {
  id: string;
  guildId: string;
  policyId: string | null;
  source: string;
  status: string;
  action: string;
  targetUserId: string | null;
  sourceMessageId: string | null;
  channelId: string | null;
  reviewChannelId: string | null;
  createdByUserId: string | null;
  executedByUserId: string | null;
  evidenceJson: unknown;
  metadataJson: unknown;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ModerationPolicyDelegate = {
  create: (args: unknown) => Promise<ModerationPolicyRow>;
  findUnique: (args: unknown) => Promise<ModerationPolicyRow | null>;
  findMany: (args: unknown) => Promise<ModerationPolicyRow[]>;
  upsert: (args: unknown) => Promise<ModerationPolicyRow>;
  update: (args: unknown) => Promise<ModerationPolicyRow>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
  deleteMany: (args: unknown) => Promise<unknown>;
};

type ModerationCaseDelegate = {
  create: (args: unknown) => Promise<ModerationCaseRow>;
  findMany: (args: unknown) => Promise<ModerationCaseRow[]>;
  update: (args: unknown) => Promise<ModerationCaseRow>;
};

const policyDelegate = (prisma as unknown as { moderationPolicy: ModerationPolicyDelegate }).moderationPolicy;
const caseDelegate = (prisma as unknown as { moderationCase: ModerationCaseDelegate }).moderationCase;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toPolicyRecord(row: ModerationPolicyRow): ModerationPolicyRecord {
  return {
    ...row,
    family: row.family as ModerationPolicyRecord['family'],
    backend: row.backend as ModerationPolicyRecord['backend'],
    ownership: row.ownership as ModerationPolicyRecord['ownership'],
    mode: row.mode as ModerationPolicyRecord['mode'],
    policySpecJson: row.policySpecJson as ModerationPolicyRecord['policySpecJson'],
    compiledPolicyJson: row.compiledPolicyJson as ModerationPolicyRecord['compiledPolicyJson'],
  };
}

function toCaseRecord(row: ModerationCaseRow): ModerationCaseRecord {
  return {
    ...row,
    source: row.source as ModerationCaseRecord['source'],
    status: row.status as ModerationCaseRecord['status'],
    evidenceJson: asRecord(row.evidenceJson),
    metadataJson: asRecord(row.metadataJson),
  };
}

export async function listModerationPoliciesByGuild(guildId: string): Promise<ModerationPolicyRecord[]> {
  const rows = await policyDelegate.findMany({
    where: { guildId },
    orderBy: [{ ownership: 'asc' }, { updatedAt: 'desc' }],
  });
  return rows.map(toPolicyRecord);
}

export async function getModerationPolicyById(id: string): Promise<ModerationPolicyRecord | null> {
  const row = await policyDelegate.findUnique({ where: { id } });
  return row ? toPolicyRecord(row) : null;
}

export async function getModerationPolicyByGuildName(params: {
  guildId: string;
  name: string;
}): Promise<ModerationPolicyRecord | null> {
  const row = await policyDelegate.findUnique({
    where: {
      guildId_name: {
        guildId: params.guildId,
        name: params.name,
      },
    },
  });
  return row ? toPolicyRecord(row) : null;
}

export async function getModerationPolicyByExternalRuleId(params: {
  guildId: string;
  externalRuleId: string;
}): Promise<ModerationPolicyRecord | null> {
  const row = await policyDelegate.findUnique({
    where: {
      guildId_externalRuleId: {
        guildId: params.guildId,
        externalRuleId: params.externalRuleId,
      },
    },
  });
  return row ? toPolicyRecord(row) : null;
}

export async function upsertModerationPolicy(params: {
  id?: string;
  guildId: string;
  name: string;
  descriptionText?: string | null;
  family: ModerationPolicyRecord['family'];
  backend: ModerationPolicyRecord['backend'];
  ownership: ModerationPolicyRecord['ownership'];
  mode: ModerationPolicyRecord['mode'];
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  externalRuleId?: string | null;
  notifyChannelId?: string | null;
  policySpecJson: ModerationPolicyRecord['policySpecJson'];
  compiledPolicyJson: ModerationPolicyRecord['compiledPolicyJson'];
  lastSyncedAt?: Date | null;
  lastConflictText?: string | null;
  incrementVersion?: boolean;
}): Promise<ModerationPolicyRecord> {
  if (params.id) {
    const existingById = await getModerationPolicyById(params.id);
    if (!existingById) {
      throw new Error('Moderation policy not found.');
    }
    const row = await policyDelegate.update({
      where: { id: params.id },
      data: {
        name: params.name,
        descriptionText: params.descriptionText ?? null,
        family: params.family,
        backend: params.backend,
        ownership: params.ownership,
        mode: params.mode,
        updatedByUserId: params.updatedByUserId ?? params.createdByUserId ?? null,
        externalRuleId: params.externalRuleId ?? null,
        notifyChannelId: params.notifyChannelId ?? null,
        policySpecJson: params.policySpecJson,
        compiledPolicyJson: params.compiledPolicyJson,
        lastSyncedAt: params.lastSyncedAt ?? null,
        lastConflictText: params.lastConflictText ?? null,
        version: params.incrementVersion ? existingById.version + 1 : undefined,
      },
    });
    return toPolicyRecord(row);
  }

  const existing = await getModerationPolicyByGuildName({
    guildId: params.guildId,
    name: params.name,
  });
  const row = await policyDelegate.upsert({
    where: {
      guildId_name: {
        guildId: params.guildId,
        name: params.name,
      },
    },
    create: {
      guildId: params.guildId,
      name: params.name,
      descriptionText: params.descriptionText ?? null,
      family: params.family,
      backend: params.backend,
      ownership: params.ownership,
      mode: params.mode,
      createdByUserId: params.createdByUserId ?? null,
      updatedByUserId: params.updatedByUserId ?? params.createdByUserId ?? null,
      externalRuleId: params.externalRuleId ?? null,
      notifyChannelId: params.notifyChannelId ?? null,
      policySpecJson: params.policySpecJson,
      compiledPolicyJson: params.compiledPolicyJson,
      lastSyncedAt: params.lastSyncedAt ?? null,
      lastConflictText: params.lastConflictText ?? null,
    },
    update: {
      descriptionText: params.descriptionText ?? null,
      family: params.family,
      backend: params.backend,
      ownership: params.ownership,
      mode: params.mode,
      updatedByUserId: params.updatedByUserId ?? params.createdByUserId ?? null,
      externalRuleId: params.externalRuleId ?? null,
      notifyChannelId: params.notifyChannelId ?? null,
      policySpecJson: params.policySpecJson,
      compiledPolicyJson: params.compiledPolicyJson,
      lastSyncedAt: params.lastSyncedAt ?? null,
      lastConflictText: params.lastConflictText ?? null,
      version: params.incrementVersion && existing ? existing.version + 1 : undefined,
    },
  });
  return toPolicyRecord(row);
}

export async function updateModerationPolicyMode(params: {
  id: string;
  mode: ModerationPolicyRecord['mode'];
  updatedByUserId?: string | null;
  lastConflictText?: string | null;
}): Promise<ModerationPolicyRecord> {
  const row = await policyDelegate.update({
    where: { id: params.id },
    data: {
      mode: params.mode,
      updatedByUserId: params.updatedByUserId ?? null,
      lastConflictText: params.lastConflictText ?? null,
    },
  });
  return toPolicyRecord(row);
}

export async function upsertExternalModerationPolicy(params: {
  guildId: string;
  externalRuleId: string;
  name: string;
  descriptionText?: string | null;
  family: ModerationPolicyRecord['family'];
  backend: ModerationPolicyRecord['backend'];
  mode: ModerationPolicyRecord['mode'];
  notifyChannelId?: string | null;
  policySpecJson: ModerationPolicyRecord['policySpecJson'];
  compiledPolicyJson: ModerationPolicyRecord['compiledPolicyJson'];
  lastSyncedAt?: Date | null;
  lastConflictText?: string | null;
}): Promise<ModerationPolicyRecord> {
  const existing =
    (await getModerationPolicyByExternalRuleId({
      guildId: params.guildId,
      externalRuleId: params.externalRuleId,
    })) ??
    (await getModerationPolicyByGuildName({
      guildId: params.guildId,
      name: params.name,
    }));

  if (!existing) {
    const created = await policyDelegate.create({
      data: {
        guildId: params.guildId,
        name: params.name,
        descriptionText: params.descriptionText ?? null,
        family: params.family,
        backend: params.backend,
        ownership: 'external_discord',
        mode: params.mode,
        externalRuleId: params.externalRuleId,
        notifyChannelId: params.notifyChannelId ?? null,
        policySpecJson: params.policySpecJson,
        compiledPolicyJson: params.compiledPolicyJson,
        lastSyncedAt: params.lastSyncedAt ?? new Date(),
        lastConflictText: params.lastConflictText ?? null,
      },
    });
    return toPolicyRecord(created);
  }

  const updated = await policyDelegate.update({
    where: { id: existing.id },
    data: {
      name: params.name,
      descriptionText: params.descriptionText ?? null,
      family: params.family,
      backend: params.backend,
      ownership: 'external_discord',
      mode: params.mode,
      externalRuleId: params.externalRuleId,
      notifyChannelId: params.notifyChannelId ?? null,
      policySpecJson: params.policySpecJson,
      compiledPolicyJson: params.compiledPolicyJson,
      lastSyncedAt: params.lastSyncedAt ?? new Date(),
      lastConflictText: params.lastConflictText ?? null,
    },
  });
  return toPolicyRecord(updated);
}

export async function deleteMissingExternalModerationPolicies(params: {
  guildId: string;
  externalRuleIds: string[];
}): Promise<void> {
  await policyDelegate.deleteMany({
    where: {
      guildId: params.guildId,
      ownership: 'external_discord',
      ...(params.externalRuleIds.length > 0
        ? {
            externalRuleId: {
              notIn: params.externalRuleIds,
            },
          }
        : {}),
    },
  });
}

export async function createModerationCase(params: {
  guildId: string;
  policyId?: string | null;
  source: ModerationCaseRecord['source'];
  status: ModerationCaseRecord['status'];
  action: string;
  targetUserId?: string | null;
  sourceMessageId?: string | null;
  channelId?: string | null;
  reviewChannelId?: string | null;
  createdByUserId?: string | null;
  executedByUserId?: string | null;
  evidenceJson?: Record<string, unknown> | null;
  metadataJson?: Record<string, unknown> | null;
  resolvedAt?: Date | null;
}): Promise<ModerationCaseRecord> {
  const row = await caseDelegate.create({
    data: {
      guildId: params.guildId,
      policyId: params.policyId ?? null,
      source: params.source,
      status: params.status,
      action: params.action,
      targetUserId: params.targetUserId ?? null,
      sourceMessageId: params.sourceMessageId ?? null,
      channelId: params.channelId ?? null,
      reviewChannelId: params.reviewChannelId ?? null,
      createdByUserId: params.createdByUserId ?? null,
      executedByUserId: params.executedByUserId ?? null,
      evidenceJson: params.evidenceJson ?? undefined,
      metadataJson: params.metadataJson ?? undefined,
      resolvedAt: params.resolvedAt ?? null,
    },
  });
  return toCaseRecord(row);
}

export async function listModerationCasesByGuild(params: {
  guildId: string;
  limit?: number;
  policyId?: string;
}): Promise<ModerationCaseRecord[]> {
  const rows = await caseDelegate.findMany({
    where: {
      guildId: params.guildId,
      ...(params.policyId ? { policyId: params.policyId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: params.limit ?? 25,
  });
  return rows.map(toCaseRecord);
}

export async function markModerationCaseResolved(params: {
  id: string;
  status: ModerationCaseRecord['status'];
  executedByUserId?: string | null;
  metadataJson?: Record<string, unknown> | null;
}): Promise<ModerationCaseRecord> {
  const row = await caseDelegate.update({
    where: { id: params.id },
    data: {
      status: params.status,
      executedByUserId: params.executedByUserId ?? null,
      metadataJson: params.metadataJson ?? undefined,
      resolvedAt: new Date(),
    },
  });
  return toCaseRecord(row);
}
