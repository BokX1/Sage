/**
 * @module src/core/embeddings/attachmentRAG
 * @description Defines the attachment rag module.
 */
import { prisma } from '../db/prisma-client';
import { logger } from '../utils/logger';
import { embedText, embedTexts } from './embeddingEngine';
import { chunkText } from './textChunker';

const DEFAULT_TOP_K = 5;

type DbSearchRow = {
  id: string;
  attachmentId: string;
  content: string;
  score: number;
};

/**
 * Represents the SearchResult contract.
 */
export interface SearchResult {
  chunkId: string;
  attachmentId: string;
  content: string;
  score: number;
}

let embeddingColumnCheckDone = false;
let embeddingColumnAvailable = false;

/** Clamp search result limits to safe bounded integers. */
function toBoundedLimit(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

async function hasEmbeddingColumn(): Promise<boolean> {
  if (embeddingColumnCheckDone) {
    return embeddingColumnAvailable;
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'AttachmentChunk'
          AND column_name = 'embedding'
      ) AS "exists"
    `;
    embeddingColumnAvailable = rows[0]?.exists === true;
  } catch (error) {
    embeddingColumnAvailable = false;
    logger.warn({ error }, 'Attachment RAG capability check failed, falling back to lexical mode');
  } finally {
    embeddingColumnCheckDone = true;
  }

  return embeddingColumnAvailable;
}

function mapRows(rows: DbSearchRow[]): SearchResult[] {
  return rows.map((row) => ({
    chunkId: row.id,
    attachmentId: row.attachmentId,
    content: row.content,
    score: row.score,
  }));
}

/**
 * Runs ingestAttachmentText.
 *
 * @param attachmentId - Describes the attachmentId input.
 * @param extractedText - Describes the extractedText input.
 * @returns Returns the function result.
 */
export async function ingestAttachmentText(
  attachmentId: string,
  extractedText: string,
): Promise<number> {
  if (!extractedText || extractedText.trim().length === 0) {
    logger.debug({ attachmentId }, 'No text to ingest, skipping');
    return 0;
  }

  const chunks = chunkText(extractedText);
  if (chunks.length === 0) {
    logger.debug({ attachmentId }, 'Chunker produced no chunks, skipping');
    return 0;
  }

  const canStoreVectors = await hasEmbeddingColumn();
  let embeddings: number[][] = [];

  if (canStoreVectors) {
    const texts = chunks.map((chunk) => chunk.content);
    embeddings = await embedTexts(texts, 'document');
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    if (canStoreVectors) {
      const vector = embeddings[i];
      const vectorString = `[${vector.join(',')}]`;
      await prisma.$executeRaw`
        INSERT INTO "AttachmentChunk" ("id", "attachmentId", "chunkIndex", "content", "tokenCount", "embedding", "createdAt")
        VALUES (
          ${generateChunkId()},
          ${attachmentId},
          ${chunk.index},
          ${chunk.content},
          ${chunk.tokenCount},
          ${vectorString}::vector,
          NOW()
        )
        ON CONFLICT ("attachmentId", "chunkIndex")
        DO UPDATE SET
          "content" = EXCLUDED."content",
          "tokenCount" = EXCLUDED."tokenCount",
          "embedding" = EXCLUDED."embedding"
      `;
      continue;
    }

    await prisma.$executeRaw`
      INSERT INTO "AttachmentChunk" ("id", "attachmentId", "chunkIndex", "content", "tokenCount", "createdAt")
      VALUES (
        ${generateChunkId()},
        ${attachmentId},
        ${chunk.index},
        ${chunk.content},
        ${chunk.tokenCount},
        NOW()
      )
      ON CONFLICT ("attachmentId", "chunkIndex")
      DO UPDATE SET
        "content" = EXCLUDED."content",
        "tokenCount" = EXCLUDED."tokenCount"
    `;
  }

  logger.info(
    { attachmentId, chunkCount: chunks.length, vectorMode: canStoreVectors },
    'Attachment ingested into chunk store',
  );
  return chunks.length;
}

/**
 * Runs searchAttachments.
 *
 * @param query - Describes the query input.
 * @param topK - Describes the topK input.
 * @param scope - Describes the scope input.
 * @returns Returns the function result.
 */
export async function searchAttachments(
  query: string,
  topK: number = DEFAULT_TOP_K,
  scope?: { guildId?: string | null; channelId?: string | null },
): Promise<SearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const limit = toBoundedLimit(topK, DEFAULT_TOP_K, 1, 20);
  const guildId = scope?.guildId ?? null;
  const channelId = scope?.channelId ?? null;
  const canUseVectors = await hasEmbeddingColumn();

  if (canUseVectors) {
    const queryVector = await embedText(normalizedQuery, 'query');
    const vectorString = `[${queryVector.join(',')}]`;

    const rows = await prisma.$queryRaw<DbSearchRow[]>`
      SELECT
        c."id",
        c."attachmentId",
        c."content",
        1 - (c."embedding" <=> ${vectorString}::vector) AS "score"
      FROM "AttachmentChunk" c
      JOIN "IngestedAttachment" a ON a."id" = c."attachmentId"
      WHERE c."embedding" IS NOT NULL
        AND (${channelId}::text IS NULL OR a."channelId" = ${channelId})
        AND (${guildId}::text IS NULL OR a."guildId" = ${guildId})
      ORDER BY c."embedding" <=> ${vectorString}::vector
      LIMIT ${limit}
    `;

    logger.debug(
      { query: query.slice(0, 80), resultCount: rows.length, vectorMode: true },
      'Attachment semantic search completed',
    );
    return mapRows(rows);
  }

  const searchTerm = `%${normalizedQuery}%`;
  const rows = await prisma.$queryRaw<DbSearchRow[]>`
    SELECT
      c."id",
      c."attachmentId",
      c."content",
      CASE
        WHEN LOWER(c."content") LIKE LOWER(${searchTerm}) THEN 1.0
        ELSE 0.0
      END AS "score"
    FROM "AttachmentChunk" c
    JOIN "IngestedAttachment" a ON a."id" = c."attachmentId"
    WHERE LOWER(c."content") LIKE LOWER(${searchTerm})
      AND (${channelId}::text IS NULL OR a."channelId" = ${channelId})
      AND (${guildId}::text IS NULL OR a."guildId" = ${guildId})
    ORDER BY "score" DESC, LENGTH(c."content") ASC
    LIMIT ${limit}
  `;

  logger.debug(
    { query: query.slice(0, 80), resultCount: rows.length, vectorMode: false },
    'Attachment lexical search completed',
  );
  return mapRows(rows);
}

/**
 * Runs deleteAttachmentChunks.
 *
 * @param attachmentId - Describes the attachmentId input.
 * @returns Returns the function result.
 */
export async function deleteAttachmentChunks(attachmentId: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "AttachmentChunk" WHERE "attachmentId" = ${attachmentId}
  `;
  logger.debug({ attachmentId }, 'Deleted attachment chunks');
}

function generateChunkId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `ck${timestamp}${random}`;
}

/**
 * Runs __resetAttachmentRagCapabilitiesForTests.
 *
 * @returns Returns the function result.
 */
export function __resetAttachmentRagCapabilitiesForTests(): void {
  embeddingColumnCheckDone = false;
  embeddingColumnAvailable = false;
}
