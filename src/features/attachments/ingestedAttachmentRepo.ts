import { prisma } from '../../platform/db/prisma-client';

/**
 * Represents the IngestedAttachmentStatus type.
 */
export type IngestedAttachmentStatus =
  | 'queued'
  | 'processing'
  | 'ok'
  | 'too_large'
  | 'error'
  | 'skip';

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
  update: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  updateMany: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<{ count: number }>;
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

/** Clamp a numeric input into a bounded integer range with fallback on invalid values. */
function toBoundedInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  return Math.max(min, Math.min(max, normalized));
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
}): Promise<IngestedAttachmentRecord> {
  const ingestedAttachment = getIngestedAttachmentClient();
  const extractedText = normalizeText(params.extractedText);
  const data = {
    guildId: params.guildId,
    channelId: params.channelId,
    messageId: params.messageId,
    attachmentIndex: toBoundedInt(
      params.attachmentIndex,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
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

  const row = await ingestedAttachment.upsert({
    where: {
      messageId_attachmentIndex: {
        messageId: data.messageId,
        attachmentIndex: data.attachmentIndex,
      },
    },
    create: data,
    update: data,
  });

  return mapRow(row);
}

export async function listRecentIngestedAttachments(params: {
  guildId: string | null;
  channelId: string;
  limit: number;
}): Promise<IngestedAttachmentRecord[]> {
  const ingestedAttachment = getIngestedAttachmentClient();
  const take = toBoundedInt(params.limit, 1, 1, 50);
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
  const requestedLimit = toBoundedInt(params.limit, 1, 1, 10);
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

export async function findIngestedAttachmentsForLookupInGuild(params: {
  guildId: string;
  messageId?: string;
  filename?: string;
  query?: string;
  limit: number;
}): Promise<IngestedAttachmentRecord[]> {
  const ingestedAttachment = getIngestedAttachmentClient();
  const requestedLimit = toBoundedInt(params.limit, 1, 1, 50);
  const query = params.query?.trim();
  const filename = params.filename?.trim();

  const where: Record<string, unknown> = {
    guildId: params.guildId,
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
    take: Math.max(20, requestedLimit * 12),
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

export async function listIngestedAttachmentsByIds(ids: string[]): Promise<IngestedAttachmentRecord[]> {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0)));
  if (uniqueIds.length === 0) return [];

  const ingestedAttachment = getIngestedAttachmentClient();
  const rows = await ingestedAttachment.findMany({
    where: {
      id: { in: uniqueIds },
    },
    orderBy: { createdAt: 'desc' },
    take: uniqueIds.length,
  });

  return rows.map(mapRow);
}

export async function requeueStaleVisionAttachments(params: {
  staleBefore: Date;
}): Promise<number> {
  const ingestedAttachment = getIngestedAttachmentClient();
  const result = await ingestedAttachment.updateMany({
    where: {
      extractor: 'vision',
      status: 'processing',
      updatedAt: { lt: params.staleBefore },
    },
    data: {
      status: 'queued',
      errorText: '[System: Re-queued stale image recall task after worker interruption.]',
    },
  });
  return result.count;
}

export async function claimNextQueuedVisionAttachment(): Promise<IngestedAttachmentRecord | null> {
  const ingestedAttachment = getIngestedAttachmentClient();
  const candidates = await ingestedAttachment.findMany({
    where: {
      extractor: 'vision',
      status: 'queued',
    },
    orderBy: { createdAt: 'asc' },
    take: 10,
  });

  for (const row of candidates) {
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) continue;

    const claimed = await ingestedAttachment.updateMany({
      where: {
        id,
        status: 'queued',
      },
      data: {
        status: 'processing',
        errorText: null,
      },
    });

    if (claimed.count > 0) {
      const [updated] = await ingestedAttachment.findMany({
        where: { id },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      return updated ? mapRow(updated) : null;
    }
  }

  return null;
}

export async function updateIngestedAttachmentById(params: {
  id: string;
  status?: IngestedAttachmentStatus;
  readSizeBytes?: number | null;
  extractor?: string | null;
  errorText?: string | null;
  extractedText?: string | null;
}): Promise<IngestedAttachmentRecord> {
  const ingestedAttachment = getIngestedAttachmentClient();
  const extractedText = normalizeText(params.extractedText);
  const data: Record<string, unknown> = {};

  if (params.status) data.status = params.status;
  if (params.readSizeBytes !== undefined) data.readSizeBytes = toIntOrNull(params.readSizeBytes);
  if (params.extractor !== undefined) data.extractor = params.extractor ?? null;
  if (params.errorText !== undefined) data.errorText = params.errorText ?? null;
  if (params.extractedText !== undefined) {
    data.extractedText = extractedText;
    data.extractedTextChars = extractedText?.length ?? 0;
  }

  const row = await ingestedAttachment.update({
    where: { id: params.id.trim() },
    data,
  });
  return mapRow(row);
}
