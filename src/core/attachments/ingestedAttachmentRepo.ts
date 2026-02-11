import { prisma } from '../db/prisma-client';

export type IngestedAttachmentStatus = 'ok' | 'truncated' | 'too_large' | 'error' | 'skip';

export interface IngestedAttachmentRecord {
  id: string;
  guildId: string | null;
  channelId: string;
  messageId: string;
  attachmentIndex: number;
  filename: string;
  sourceUrl: string;
  contentType: string | null;
  declaredSizeBytes: number | null;
  readSizeBytes: number | null;
  extractor: string | null;
  status: IngestedAttachmentStatus;
  errorText: string | null;
  extractedText: string | null;
  extractedTextChars: number;
  createdAt: Date;
  updatedAt: Date;
}

type PrismaIngestedAttachmentClient = {
  upsert: (args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  findMany: (args: {
    where: Record<string, unknown>;
    orderBy: Record<string, 'asc' | 'desc'>;
    take: number;
  }) => Promise<Record<string, unknown>[]>;
};

function getIngestedAttachmentClient(): PrismaIngestedAttachmentClient {
  return (prisma as unknown as { ingestedAttachment: PrismaIngestedAttachmentClient }).ingestedAttachment;
}

function toIntOrNull(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n/g, '\n').trimEnd();
  return normalized.length > 0 ? normalized : null;
}

function mapRow(row: Record<string, unknown>): IngestedAttachmentRecord {
  return {
    id: row.id as string,
    guildId: (row.guildId as string | null) ?? null,
    channelId: row.channelId as string,
    messageId: row.messageId as string,
    attachmentIndex: row.attachmentIndex as number,
    filename: row.filename as string,
    sourceUrl: row.sourceUrl as string,
    contentType: (row.contentType as string | null) ?? null,
    declaredSizeBytes: (row.declaredSizeBytes as number | null) ?? null,
    readSizeBytes: (row.readSizeBytes as number | null) ?? null,
    extractor: (row.extractor as string | null) ?? null,
    status: row.status as IngestedAttachmentStatus,
    errorText: (row.errorText as string | null) ?? null,
    extractedText: (row.extractedText as string | null) ?? null,
    extractedTextChars: (row.extractedTextChars as number) ?? 0,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

export async function upsertIngestedAttachment(params: {
  guildId: string | null;
  channelId: string;
  messageId: string;
  attachmentIndex: number;
  filename: string;
  sourceUrl: string;
  contentType?: string | null;
  declaredSizeBytes?: number | null;
  readSizeBytes?: number | null;
  extractor?: string | null;
  status: IngestedAttachmentStatus;
  errorText?: string | null;
  extractedText?: string | null;
}): Promise<void> {
  const ingestedAttachment = getIngestedAttachmentClient();
  const extractedText = normalizeText(params.extractedText);
  const data = {
    guildId: params.guildId,
    channelId: params.channelId,
    messageId: params.messageId,
    attachmentIndex: Math.max(0, Math.floor(params.attachmentIndex)),
    filename: params.filename.trim(),
    sourceUrl: params.sourceUrl,
    contentType: params.contentType ?? null,
    declaredSizeBytes: toIntOrNull(params.declaredSizeBytes),
    readSizeBytes: toIntOrNull(params.readSizeBytes),
    extractor: params.extractor ?? null,
    status: params.status,
    errorText: params.errorText ?? null,
    extractedText,
    extractedTextChars: extractedText?.length ?? 0,
  };

  await ingestedAttachment.upsert({
    where: {
      messageId_attachmentIndex: {
        messageId: data.messageId,
        attachmentIndex: data.attachmentIndex,
      },
    },
    create: data,
    update: data,
  });
}

export async function listRecentIngestedAttachments(params: {
  guildId: string | null;
  channelId: string;
  limit: number;
}): Promise<IngestedAttachmentRecord[]> {
  const ingestedAttachment = getIngestedAttachmentClient();
  const take = Math.max(1, Math.min(50, Math.floor(params.limit)));
  const rows = await ingestedAttachment.findMany({
    where: {
      guildId: params.guildId,
      channelId: params.channelId,
    },
    orderBy: { createdAt: 'desc' },
    take,
  });

  return rows.map(mapRow);
}

function rankLookupHit(params: {
  row: IngestedAttachmentRecord;
  messageId?: string;
  filename?: string;
  query?: string;
}): number {
  const query = params.query?.trim().toLowerCase() ?? '';
  const filename = params.filename?.trim().toLowerCase() ?? '';
  const rowFilename = params.row.filename.toLowerCase();
  let score = 0;

  if (params.messageId && params.row.messageId === params.messageId) score += 100;
  if (filename && rowFilename === filename) score += 80;
  if (filename && rowFilename.includes(filename)) score += 40;
  if (query && rowFilename.includes(query)) score += 30;
  if (query && params.row.messageId.toLowerCase().includes(query)) score += 20;
  if (params.row.status === 'ok') score += 15;
  if (params.row.status === 'truncated') score += 10;

  return score;
}

export async function findIngestedAttachmentsForLookup(params: {
  guildId: string | null;
  channelId: string;
  messageId?: string;
  filename?: string;
  query?: string;
  limit: number;
}): Promise<IngestedAttachmentRecord[]> {
  const ingestedAttachment = getIngestedAttachmentClient();
  const requestedLimit = Math.max(1, Math.min(10, Math.floor(params.limit)));
  const query = params.query?.trim();
  const filename = params.filename?.trim();

  const where: Record<string, unknown> = {
    guildId: params.guildId,
    channelId: params.channelId,
  };

  if (params.messageId?.trim()) {
    where.messageId = params.messageId.trim();
  }

  if (filename || query) {
    const orFilters: Record<string, unknown>[] = [];
    if (filename) {
      orFilters.push({ filename: { contains: filename, mode: 'insensitive' } });
    }
    if (query) {
      orFilters.push({ filename: { contains: query, mode: 'insensitive' } });
      orFilters.push({ messageId: { contains: query, mode: 'insensitive' } });
    }
    if (orFilters.length > 0) {
      where.OR = orFilters;
    }
  }

  const rows = await ingestedAttachment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.max(5, requestedLimit * 6),
  });

  const mapped = rows.map(mapRow);
  mapped.sort((a, b) => {
    const rankA = rankLookupHit({
      row: a,
      messageId: params.messageId,
      filename: params.filename,
      query: params.query,
    });
    const rankB = rankLookupHit({
      row: b,
      messageId: params.messageId,
      filename: params.filename,
      query: params.query,
    });
    if (rankA !== rankB) return rankB - rankA;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return mapped.slice(0, requestedLimit);
}
