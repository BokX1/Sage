import { config } from '../../platform/config/env';
import {
  fetchDiscordAttachmentBytes,
  type FetchDiscordAttachmentBytesResult,
} from '../../platform/files/file-handler';
import { logger } from '../../platform/logging/logger';
import {
  claimNextQueuedVisionAttachment,
  requeueStaleVisionAttachments,
  updateIngestedAttachmentById,
} from './ingestedAttachmentRepo';
import { summarizeImageAttachmentForRecall } from './imageAttachmentRecall';

const STALE_PROCESSING_MS = 15 * 60_000;

let initPromise: Promise<void> | null = null;
let drainPromise: Promise<void> | null = null;
let rerunRequested = false;

async function loadAttachmentIndexingTools(): Promise<typeof import('../embeddings')> {
  return import('../embeddings');
}

function isImageRecallEnabled(): boolean {
  return !!config.FILE_INGEST_IMAGE_ENABLED;
}

async function requeueStaleWork(): Promise<void> {
  const reclaimed = await requeueStaleVisionAttachments({
    staleBefore: new Date(Date.now() - STALE_PROCESSING_MS),
  });
  if (reclaimed > 0) {
    logger.warn({ reclaimed }, 'Re-queued stale image attachment recall jobs');
  }
}

async function processFetchedAttachment(params: {
  attachmentId: string;
  fetched: Extract<FetchDiscordAttachmentBytesResult, { kind: 'ok' }>;
  contentType: string | null;
}): Promise<void> {
  const recall = await summarizeImageAttachmentForRecall({
    buffer: params.fetched.buffer,
    contentType: params.fetched.mimeType ?? params.contentType,
    modelId: config.FILE_INGEST_IMAGE_MODEL_ID,
    timeoutMs: config.FILE_INGEST_IMAGE_TIMEOUT_MS,
  });

  if (!recall.text) {
    await updateIngestedAttachmentById({
      id: params.attachmentId,
      status: 'skip',
      readSizeBytes: params.fetched.byteLength ?? null,
      extractor: 'vision',
      errorText: '[System: Image recall text was unavailable after local Florence processing.]',
      extractedText: null,
    });
    return;
  }

  await updateIngestedAttachmentById({
    id: params.attachmentId,
    status: 'ok',
    readSizeBytes: params.fetched.byteLength ?? null,
    extractor: 'vision',
    errorText: null,
    extractedText: recall.text,
  });

  try {
    const { deleteAttachmentChunks, ingestAttachmentText } = await loadAttachmentIndexingTools();
    await deleteAttachmentChunks(params.attachmentId);
    await ingestAttachmentText(params.attachmentId, recall.text);
  } catch (error) {
    logger.warn(
      { error, attachmentId: params.attachmentId },
      'Image attachment chunk embedding/indexing failed (non-fatal)',
    );
  }
}

async function processRecord(record: Awaited<ReturnType<typeof claimNextQueuedVisionAttachment>>): Promise<void> {
  if (!record) return;

  try {
    const fetched = await fetchDiscordAttachmentBytes(record.sourceUrl, record.filename, {
      timeoutMs: config.FILE_INGEST_IMAGE_TIMEOUT_MS,
      maxBytes: config.FILE_INGEST_MAX_BYTES_PER_FILE,
      declaredSizeBytes: record.declaredSizeBytes,
      contentType: record.contentType,
      allowImages: true,
    });

    if (fetched.kind === 'ok') {
      await processFetchedAttachment({
        attachmentId: record.id,
        fetched,
        contentType: record.contentType,
      });
      return;
    }

    const errorText =
      fetched.kind === 'skip'
        ? fetched.reason
        : fetched.kind === 'too_large'
          ? fetched.message
          : fetched.message;

    await updateIngestedAttachmentById({
      id: record.id,
      status: fetched.kind === 'skip' ? 'skip' : 'error',
      readSizeBytes: fetched.byteLength ?? null,
      extractor: 'vision',
      errorText,
      extractedText: null,
    });
  } catch (error) {
    await updateIngestedAttachmentById({
      id: record.id,
      status: 'error',
      extractor: 'vision',
      errorText: error instanceof Error ? error.message : String(error),
      extractedText: null,
    }).catch((updateError) => {
      logger.warn({ error: updateError, attachmentId: record.id }, 'Failed to mark image recall error state');
    });
  }
}

async function drainQueue(): Promise<void> {
  await requeueStaleWork();

  while (true) {
    const record = await claimNextQueuedVisionAttachment();
    if (!record) return;
    await processRecord(record);
  }
}

function scheduleDrain(): void {
  if (!isImageRecallEnabled()) return;

  if (drainPromise) {
    rerunRequested = true;
    return;
  }

  drainPromise = drainQueue()
    .catch((error) => {
      logger.error({ error }, 'Image attachment recall worker failed');
    })
    .finally(() => {
      drainPromise = null;
      if (rerunRequested) {
        rerunRequested = false;
        scheduleDrain();
      }
    });
}

async function ensureInitialized(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!isImageRecallEnabled()) return;
    await requeueStaleWork();
    scheduleDrain();
  })().finally(() => {
    initPromise = null;
  });

  return initPromise;
}

export function initImageAttachmentRecallWorker(): void {
  void ensureInitialized().catch((error) => {
    logger.error({ error }, 'Failed to initialize image attachment recall worker');
  });
}

export function queueImageAttachmentRecall(): void {
  void ensureInitialized()
    .then(() => {
      scheduleDrain();
    })
    .catch((error) => {
      logger.error({ error }, 'Failed to queue image attachment recall work');
    });
}

export function __resetImageAttachmentRecallWorkerForTests(): void {
  initPromise = null;
  drainPromise = null;
  rerunRequested = false;
}
