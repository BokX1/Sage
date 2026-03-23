import { prisma } from '../../platform/db/prisma-client';
import type { ModerationCaseNoteRecord, ModerationCaseRecord, ModerationPolicyRecord } from './types';

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
  lifecycleStatus: string;
  action: string;
  targetUserId: string | null;
  sourceMessageId: string | null;
  channelId: string | null;
  reviewChannelId: string | null;
  createdByUserId: string | null;
  acknowledgedByUserId: string | null;
  acknowledgedAt: Date | null;
  executedByUserId: string | null;
  resolutionReasonText: string | null;
  evidenceJson: unknown;
  metadataJson: unknown;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ModerationCaseNoteRow = {
  id: string;
  caseId: string;
  guildId: string;
  createdByUserId: string;
  noteText: string;
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
  findUnique: (args: unknown) => Promise<ModerationCaseRow | null>;
  findMany: (args: unknown) => Promise<ModerationCaseRow[]>;
  update: (args: unknown) => Promise<ModerationCaseRow>;
};
type ModerationCaseNoteDelegate = {
  create: (args: unknown) => Promise<ModerationCaseNoteRow>;
  findMany: (args: unknown) => Promise<ModerationCaseNoteRow[]>;
};

const policyDelegate = (prisma as unknown as { moderationPolicy: ModerationPolicyDelegate }).moderationPolicy;
const caseDelegate = (prisma as unknown as { moderationCase: ModerationCaseDelegate }).moderationCase;
const caseNoteDelegate = (prisma as unknown as { moderationCaseNote: ModerationCaseNoteDelegate }).moderationCaseNote;

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
    lifecycleStatus: row.lifecycleStatus as ModerationCaseRecord['lifecycleStatus'],
    evidenceJson: asRecord(row.evidenceJson),
    metadataJson: asRecord(row.metadataJson),
  };
}

function toCaseNoteRecord(row: ModerationCaseNoteRow): ModerationCaseNoteRecord {
  return row;
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
  lifecycleStatus?: ModerationCaseRecord['lifecycleStatus'];
  action: string;
  targetUserId?: string | null;
  sourceMessageId?: string | null;
  channelId?: string | null;
  reviewChannelId?: string | null;
  createdByUserId?: string | null;
  acknowledgedByUserId?: string | null;
  acknowledgedAt?: Date | null;
  executedByUserId?: string | null;
  resolutionReasonText?: string | null;
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
      lifecycleStatus: params.lifecycleStatus ?? 'open',
      action: params.action,
      targetUserId: params.targetUserId ?? null,
      sourceMessageId: params.sourceMessageId ?? null,
      channelId: params.channelId ?? null,
      reviewChannelId: params.reviewChannelId ?? null,
      createdByUserId: params.createdByUserId ?? null,
      acknowledgedByUserId: params.acknowledgedByUserId ?? null,
      acknowledgedAt: params.acknowledgedAt ?? null,
      executedByUserId: params.executedByUserId ?? null,
      resolutionReasonText: params.resolutionReasonText ?? null,
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
  targetUserId?: string;
}): Promise<ModerationCaseRecord[]> {
  const rows = await caseDelegate.findMany({
    where: {
      guildId: params.guildId,
      ...(params.policyId ? { policyId: params.policyId } : {}),
      ...(params.targetUserId ? { targetUserId: params.targetUserId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: params.limit ?? 25,
  });
  return rows.map(toCaseRecord);
}

export async function getModerationCaseById(id: string): Promise<ModerationCaseRecord | null> {
  const row = await caseDelegate.findUnique({ where: { id } });
  return row ? toCaseRecord(row) : null;
}

export async function markModerationCaseResolved(params: {
  id: string;
  status: ModerationCaseRecord['status'];
  lifecycleStatus?: ModerationCaseRecord['lifecycleStatus'];
  executedByUserId?: string | null;
  resolutionReasonText?: string | null;
  metadataJson?: Record<string, unknown> | null;
}): Promise<ModerationCaseRecord> {
  const row = await caseDelegate.update({
    where: { id: params.id },
    data: {
      status: params.status,
      lifecycleStatus: params.lifecycleStatus ?? 'resolved',
      executedByUserId: params.executedByUserId ?? null,
      resolutionReasonText: params.resolutionReasonText ?? null,
      metadataJson: params.metadataJson ?? undefined,
      resolvedAt: new Date(),
    },
  });
  return toCaseRecord(row);
}

export async function acknowledgeModerationCase(params: {
  id: string;
  acknowledgedByUserId: string;
}): Promise<ModerationCaseRecord> {
  const row = await caseDelegate.update({
    where: { id: params.id },
    data: {
      lifecycleStatus: 'acknowledged',
      acknowledgedByUserId: params.acknowledgedByUserId,
      acknowledgedAt: new Date(),
    },
  });
  return toCaseRecord(row);
}

export async function addModerationCaseNote(params: {
  caseId: string;
  guildId: string;
  createdByUserId: string;
  noteText: string;
}): Promise<ModerationCaseNoteRecord> {
  const row = await caseNoteDelegate.create({
    data: {
      caseId: params.caseId,
      guildId: params.guildId,
      createdByUserId: params.createdByUserId,
      noteText: params.noteText,
    },
  });
  return toCaseNoteRecord(row);
}

export async function listModerationCaseNotes(caseId: string): Promise<ModerationCaseNoteRecord[]> {
  const rows = await caseNoteDelegate.findMany({
    where: { caseId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toCaseNoteRecord);
}
