import { config } from '../../config';
import { prisma } from '../db/prisma-client';
import { logger } from '../utils/logger';
import { limitConcurrency } from '../utils/concurrency';
import { embedText } from './embeddingEngine';

/**
 * Represents the ChannelMessageSearchMode type.
 */
export type ChannelMessageSearchMode = 'semantic' | 'lexical' | 'regex';

type MessageSearchRow = {
  messageId: string;
  authorId: string;
  authorDisplayName: string;
  authorIsBot: boolean;
  timestamp: Date | string;
  content: string;
  score: number;
};

type MessageBaseRow = {
  messageId: string;
  authorId: string;
  authorDisplayName: string;
  authorIsBot: boolean;
  timestamp: Date | string;
  content: string;
};

type HistoryStatsRow = {
  count: number | bigint | string | null;
  oldest: Date | string | null;
  newest: Date | string | null;
};

export interface ChannelMessageSearchResult {
  messageId: string;
  authorId: string;
  authorDisplayName: string;
  authorIsBot: boolean;
  timestamp: string;
  content: string;
  score: number;
}

export interface ChannelMessageHistoryStats {
  storedCount: number;
  retentionCap: number;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
  possiblyTruncated: boolean;
}

let embeddingColumnCheckDone = false;
let embeddingColumnAvailable = false;

const embedLimiter = limitConcurrency(2);
const inFlightEmbeddingJobs = new Map<string, Promise<void>>();

/** Normalize positive integer limits with fallback on non-finite inputs. */
function toPositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

/** Normalize non-negative integer limits with fallback on non-finite inputs. */
function toNonNegativeInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseCount(value: number | bigint | string | null): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'bigint') return Number(value > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return 0;
}

function mapSearchRows(rows: MessageSearchRow[]): ChannelMessageSearchResult[] {
  return rows.map((row) => ({
    messageId: row.messageId,
    authorId: row.authorId,
    authorDisplayName: row.authorDisplayName,
    authorIsBot: !!row.authorIsBot,
    timestamp: toIso(row.timestamp)!,
    content: row.content,
    score: Number.isFinite(row.score) ? Number(row.score) : 0,
  }));
}

async function hasMessageEmbeddingColumn(): Promise<boolean> {
  if (embeddingColumnCheckDone) {
    return embeddingColumnAvailable;
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ChannelMessageEmbedding'
          AND column_name = 'embedding'
      ) AS "exists"
    `;
    embeddingColumnAvailable = rows[0]?.exists === true;
  } catch (error) {
    embeddingColumnAvailable = false;
    logger.warn({ error }, 'Channel message embedding capability check failed');
  } finally {
    embeddingColumnCheckDone = true;
  }

  return embeddingColumnAvailable;
}

export async function supportsChannelMessageSemanticSearch(): Promise<boolean> {
  return hasMessageEmbeddingColumn();
}

export function queueChannelMessageEmbedding(params: {
  messageId: string;
  guildId: string | null;
  channelId: string;
  content: string;
}): void {
  if (!config.MESSAGE_DB_STORAGE_ENABLED) {
    return;
  }
  const trimmedContent = params.content.trim();
  if (!trimmedContent) {
    return;
  }
  if (inFlightEmbeddingJobs.has(params.messageId)) {
    return;
  }

  const task = embedLimiter(async () => {
    const canEmbed = await hasMessageEmbeddingColumn();
    if (!canEmbed) return;

    const vector = await embedText(trimmedContent, 'document');
    const vectorString = `[${vector.join(',')}]`;

    await prisma.$executeRaw`
      INSERT INTO "ChannelMessageEmbedding" ("messageId", "guildId", "channelId", "embedding", "createdAt")
      VALUES (
        ${params.messageId},
        ${params.guildId},
        ${params.channelId},
        ${vectorString}::vector,
        NOW()
      )
      ON CONFLICT ("messageId")
      DO UPDATE SET
        "guildId" = EXCLUDED."guildId",
        "channelId" = EXCLUDED."channelId",
        "embedding" = EXCLUDED."embedding"
    `;
  })
    .catch((error) => {
      logger.warn(
        { error, messageId: params.messageId, channelId: params.channelId },
        'Channel message embedding indexing failed (non-fatal)',
      );
    })
    .finally(() => {
      inFlightEmbeddingJobs.delete(params.messageId);
    });

  inFlightEmbeddingJobs.set(params.messageId, task);
  void task;
}

export async function searchChannelMessagesLexical(params: {
  guildId: string | null;
  channelId: string;
  query: string;
  topK: number;
  since?: Date;
  until?: Date;
}): Promise<ChannelMessageSearchResult[]> {
  const limit = toPositiveInt(params.topK, 10);
  const rows = await prisma.$queryRaw<MessageSearchRow[]>`
    SELECT
      m."messageId",
      m."authorId",
      m."authorDisplayName",
      m."authorIsBot",
      m."timestamp",
      m."content",
      ts_rank_cd(
        to_tsvector('simple', m."content"),
        websearch_to_tsquery('simple', ${params.query})
      ) AS "score"
    FROM "ChannelMessage" m
    WHERE m."channelId" = ${params.channelId}
      AND (${params.guildId}::text IS NULL OR m."guildId" = ${params.guildId})
      AND (${params.since ?? null}::timestamp IS NULL OR m."timestamp" >= ${params.since ?? null})
      AND (${params.until ?? null}::timestamp IS NULL OR m."timestamp" <= ${params.until ?? null})
      AND to_tsvector('simple', m."content") @@ websearch_to_tsquery('simple', ${params.query})
    ORDER BY "score" DESC, m."timestamp" DESC
    LIMIT ${limit}
  `;
  return mapSearchRows(rows);
}

export async function searchChannelMessagesRegex(params: {
  guildId: string | null;
  channelId: string;
  pattern: string;
  topK: number;
  since?: Date;
  until?: Date;
}): Promise<ChannelMessageSearchResult[]> {
  const limit = toPositiveInt(params.topK, 10);
  const rows = await prisma.$queryRaw<MessageSearchRow[]>`
    SELECT
      m."messageId",
      m."authorId",
      m."authorDisplayName",
      m."authorIsBot",
      m."timestamp",
      m."content",
      1.0 AS "score"
    FROM "ChannelMessage" m
    WHERE m."channelId" = ${params.channelId}
      AND (${params.guildId}::text IS NULL OR m."guildId" = ${params.guildId})
      AND (${params.since ?? null}::timestamp IS NULL OR m."timestamp" >= ${params.since ?? null})
      AND (${params.until ?? null}::timestamp IS NULL OR m."timestamp" <= ${params.until ?? null})
      AND m."content" ~* ${params.pattern}
    ORDER BY m."timestamp" DESC
    LIMIT ${limit}
  `;
  return mapSearchRows(rows);
}

export async function searchChannelMessagesSemantic(params: {
  guildId: string | null;
  channelId: string;
  query: string;
  topK: number;
  since?: Date;
  until?: Date;
}): Promise<ChannelMessageSearchResult[]> {
  const canEmbed = await hasMessageEmbeddingColumn();
  if (!canEmbed) {
    return [];
  }
  const limit = toPositiveInt(params.topK, 10);

  const queryVector = await embedText(params.query, 'query');
  const vectorString = `[${queryVector.join(',')}]`;
  const rows = await prisma.$queryRaw<MessageSearchRow[]>`
    SELECT
      m."messageId",
      m."authorId",
      m."authorDisplayName",
      m."authorIsBot",
      m."timestamp",
      m."content",
      1 - (e."embedding" <=> ${vectorString}::vector) AS "score"
    FROM "ChannelMessageEmbedding" e
    JOIN "ChannelMessage" m ON m."messageId" = e."messageId"
    WHERE e."embedding" IS NOT NULL
      AND e."channelId" = ${params.channelId}
      AND (${params.guildId}::text IS NULL OR e."guildId" = ${params.guildId})
      AND (${params.since ?? null}::timestamp IS NULL OR m."timestamp" >= ${params.since ?? null})
      AND (${params.until ?? null}::timestamp IS NULL OR m."timestamp" <= ${params.until ?? null})
    ORDER BY e."embedding" <=> ${vectorString}::vector
    LIMIT ${limit}
  `;
  return mapSearchRows(rows);
}

export async function getChannelMessageHistoryStats(params: {
  guildId: string | null;
  channelId: string;
}): Promise<ChannelMessageHistoryStats> {
  const rows = await prisma.$queryRaw<HistoryStatsRow[]>`
    SELECT
      COUNT(*)::bigint AS "count",
      MIN(m."timestamp") AS "oldest",
      MAX(m."timestamp") AS "newest"
    FROM "ChannelMessage" m
    WHERE m."channelId" = ${params.channelId}
      AND (${params.guildId}::text IS NULL OR m."guildId" = ${params.guildId})
  `;

  const first = rows[0];
  const storedCount = parseCount(first?.count ?? 0);
  const retentionCap = toPositiveInt(config.MESSAGE_DB_MAX_MESSAGES_PER_CHANNEL, 1);

  return {
    storedCount,
    retentionCap,
    oldestTimestamp: toIso(first?.oldest ?? null),
    newestTimestamp: toIso(first?.newest ?? null),
    possiblyTruncated: storedCount >= retentionCap,
  };
}

export async function getChannelMessageWindowById(params: {
  guildId: string | null;
  channelId: string;
  messageId: string;
  before: number;
  after: number;
}): Promise<ChannelMessageSearchResult[]> {
  const beforeLimit = toNonNegativeInt(params.before, 0);
  const afterLimit = toNonNegativeInt(params.after, 0);
  const targets = await prisma.$queryRaw<MessageBaseRow[]>`
    SELECT
      m."messageId",
      m."authorId",
      m."authorDisplayName",
      m."authorIsBot",
      m."timestamp",
      m."content"
    FROM "ChannelMessage" m
    WHERE m."messageId" = ${params.messageId}
      AND m."channelId" = ${params.channelId}
      AND (${params.guildId}::text IS NULL OR m."guildId" = ${params.guildId})
    LIMIT 1
  `;

  const target = targets[0];
  if (!target) return [];

  const beforeRows =
    beforeLimit > 0
      ? await prisma.$queryRaw<MessageBaseRow[]>`
          SELECT
            m."messageId",
            m."authorId",
            m."authorDisplayName",
            m."authorIsBot",
            m."timestamp",
            m."content"
          FROM "ChannelMessage" m
          WHERE m."channelId" = ${params.channelId}
            AND (${params.guildId}::text IS NULL OR m."guildId" = ${params.guildId})
            AND m."timestamp" < ${target.timestamp}
          ORDER BY m."timestamp" DESC
          LIMIT ${beforeLimit}
        `
      : [];
  const afterRows =
    afterLimit > 0
      ? await prisma.$queryRaw<MessageBaseRow[]>`
          SELECT
            m."messageId",
            m."authorId",
            m."authorDisplayName",
            m."authorIsBot",
            m."timestamp",
            m."content"
          FROM "ChannelMessage" m
          WHERE m."channelId" = ${params.channelId}
            AND (${params.guildId}::text IS NULL OR m."guildId" = ${params.guildId})
            AND m."timestamp" > ${target.timestamp}
          ORDER BY m."timestamp" ASC
          LIMIT ${afterLimit}
        `
      : [];

  const ordered = [...beforeRows.reverse(), target, ...afterRows];
  return ordered.map((row) => ({
    messageId: row.messageId,
    authorId: row.authorId,
    authorDisplayName: row.authorDisplayName,
    authorIsBot: !!row.authorIsBot,
    timestamp: toIso(row.timestamp)!,
    content: row.content,
    score: row.messageId === params.messageId ? 1 : 0,
  }));
}

export function __resetChannelMessageRagCapabilitiesForTests(): void {
  embeddingColumnCheckDone = false;
  embeddingColumnAvailable = false;
}
