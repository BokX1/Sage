import { prisma } from '../../platform/db/prisma-client';
import type {
  DiscordArtifactLinkRecord,
  DiscordArtifactRecord,
  DiscordArtifactRevisionRecord,
} from './types';

type ArtifactRow = Omit<DiscordArtifactRecord, never>;
type RevisionRow = Omit<DiscordArtifactRevisionRecord, 'metadataJson'> & { metadataJson: unknown };
type LinkRow = Omit<DiscordArtifactLinkRecord, never>;

type ArtifactDelegate = {
  create: (args: unknown) => Promise<ArtifactRow>;
  findUnique: (args: unknown) => Promise<ArtifactRow | null>;
  findMany: (args: unknown) => Promise<ArtifactRow[]>;
  update: (args: unknown) => Promise<ArtifactRow>;
  count: (args?: unknown) => Promise<number>;
};

type RevisionDelegate = {
  create: (args: unknown) => Promise<RevisionRow>;
  findUnique: (args: unknown) => Promise<RevisionRow | null>;
  findFirst: (args: unknown) => Promise<RevisionRow | null>;
  findMany: (args: unknown) => Promise<RevisionRow[]>;
  count: (args?: unknown) => Promise<number>;
};

type LinkDelegate = {
  create: (args: unknown) => Promise<LinkRow>;
};

const artifactDelegate = (prisma as unknown as { discordArtifact: ArtifactDelegate }).discordArtifact;
const revisionDelegate = (prisma as unknown as { discordArtifactRevision: RevisionDelegate }).discordArtifactRevision;
const linkDelegate = (prisma as unknown as { discordArtifactLink: LinkDelegate }).discordArtifactLink;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toArtifactRecord(row: ArtifactRow): DiscordArtifactRecord {
  return row;
}

function toRevisionRecord(row: RevisionRow): DiscordArtifactRevisionRecord {
  return {
    ...row,
    metadataJson: asRecord(row.metadataJson),
  };
}

function toLinkRecord(row: LinkRow): DiscordArtifactLinkRecord {
  return row;
}

export async function listArtifactsByGuild(params: {
  guildId: string;
  originChannelId?: string | null;
  createdByUserId?: string | null;
  limit?: number;
}): Promise<DiscordArtifactRecord[]> {
  const rows = await artifactDelegate.findMany({
    where: {
      guildId: params.guildId,
      ...(params.originChannelId ? { originChannelId: params.originChannelId } : {}),
      ...(params.createdByUserId ? { createdByUserId: params.createdByUserId } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: params.limit ?? 25,
  });
  return rows.map(toArtifactRecord);
}

export async function getArtifactById(id: string): Promise<DiscordArtifactRecord | null> {
  const row = await artifactDelegate.findUnique({ where: { id } });
  return row ? toArtifactRecord(row) : null;
}

export async function createArtifact(params: {
  guildId: string;
  originChannelId?: string | null;
  createdByUserId: string;
  name: string;
  filename: string;
  mediaKind: DiscordArtifactRecord['mediaKind'];
  mimeType?: string | null;
  descriptionText?: string | null;
}): Promise<DiscordArtifactRecord> {
  const row = await artifactDelegate.create({
    data: {
      guildId: params.guildId,
      originChannelId: params.originChannelId ?? null,
      createdByUserId: params.createdByUserId,
      name: params.name,
      filename: params.filename,
      mediaKind: params.mediaKind,
      mimeType: params.mimeType ?? null,
      descriptionText: params.descriptionText ?? null,
      latestRevisionNumber: 0,
    },
  });
  return toArtifactRecord(row);
}

export async function updateArtifactMetadata(params: {
  id: string;
  name?: string;
  filename?: string;
  descriptionText?: string | null;
  latestRevisionNumber?: number;
  latestPublishedChannelId?: string | null;
  latestPublishedMessageId?: string | null;
}): Promise<DiscordArtifactRecord> {
  const row = await artifactDelegate.update({
    where: { id: params.id },
    data: {
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.filename !== undefined ? { filename: params.filename } : {}),
      ...(params.descriptionText !== undefined ? { descriptionText: params.descriptionText } : {}),
      ...(params.latestRevisionNumber !== undefined ? { latestRevisionNumber: params.latestRevisionNumber } : {}),
      ...(params.latestPublishedChannelId !== undefined ? { latestPublishedChannelId: params.latestPublishedChannelId } : {}),
      ...(params.latestPublishedMessageId !== undefined ? { latestPublishedMessageId: params.latestPublishedMessageId } : {}),
    },
  });
  return toArtifactRecord(row);
}

export async function createArtifactRevision(params: {
  artifactId: string;
  createdByUserId: string;
  revisionNumber: number;
  sourceKind: DiscordArtifactRevisionRecord['sourceKind'];
  sourceAttachmentId?: string | null;
  sourceRevisionId?: string | null;
  format?: string | null;
  filename: string;
  mimeType?: string | null;
  contentText?: string | null;
  sizeBytes?: number | null;
  metadataJson?: Record<string, unknown> | null;
}): Promise<DiscordArtifactRevisionRecord> {
  const row = await revisionDelegate.create({
    data: {
      artifactId: params.artifactId,
      createdByUserId: params.createdByUserId,
      revisionNumber: params.revisionNumber,
      sourceKind: params.sourceKind,
      sourceAttachmentId: params.sourceAttachmentId ?? null,
      sourceRevisionId: params.sourceRevisionId ?? null,
      format: params.format ?? null,
      filename: params.filename,
      mimeType: params.mimeType ?? null,
      contentText: params.contentText ?? null,
      sizeBytes: params.sizeBytes ?? null,
      metadataJson: params.metadataJson ?? undefined,
    },
  });
  return toRevisionRecord(row);
}

export async function getLatestArtifactRevision(artifactId: string): Promise<DiscordArtifactRevisionRecord | null> {
  const row = await revisionDelegate.findFirst({
    where: { artifactId },
    orderBy: [{ revisionNumber: 'desc' }],
  });
  return row ? toRevisionRecord(row) : null;
}

export async function getArtifactRevisionById(id: string): Promise<DiscordArtifactRevisionRecord | null> {
  const row = await revisionDelegate.findUnique({ where: { id } });
  return row ? toRevisionRecord(row) : null;
}

export async function listArtifactRevisions(artifactId: string, limit = 25): Promise<DiscordArtifactRevisionRecord[]> {
  const rows = await revisionDelegate.findMany({
    where: { artifactId },
    orderBy: [{ revisionNumber: 'desc' }],
    take: limit,
  });
  return rows.map(toRevisionRecord);
}

export async function createArtifactLink(params: {
  artifactId: string;
  revisionId: string;
  guildId: string;
  channelId: string;
  messageId: string;
  publishedByUserId?: string | null;
}): Promise<DiscordArtifactLinkRecord> {
  const row = await linkDelegate.create({
    data: {
      artifactId: params.artifactId,
      revisionId: params.revisionId,
      guildId: params.guildId,
      channelId: params.channelId,
      messageId: params.messageId,
      publishedByUserId: params.publishedByUserId ?? null,
    },
  });
  return toLinkRecord(row);
}

export async function countArtifactDiagnostics(): Promise<{
  totalArtifacts: number;
  totalRevisions: number;
  publishedArtifacts: number;
}> {
  const [totalArtifacts, totalRevisions, publishedArtifacts] = await Promise.all([
    artifactDelegate.count(),
    revisionDelegate.count(),
    artifactDelegate.count({
      where: {
        latestPublishedMessageId: {
          not: null,
        },
      },
    }),
  ]);
  return {
    totalArtifacts,
    totalRevisions,
    publishedArtifacts,
  };
}
