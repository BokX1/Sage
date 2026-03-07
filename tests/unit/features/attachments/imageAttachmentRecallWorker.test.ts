import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/platform/config/env';

const {
  mockFetchDiscordAttachmentBytes,
  mockDeleteAttachmentChunks,
  mockIngestAttachmentText,
  mockClaimNextQueuedVisionAttachment,
  mockRequeueStaleVisionAttachments,
  mockUpdateIngestedAttachmentById,
  mockSummarizeImageAttachmentForRecall,
} = vi.hoisted(() => ({
  mockFetchDiscordAttachmentBytes: vi.fn(),
  mockDeleteAttachmentChunks: vi.fn(),
  mockIngestAttachmentText: vi.fn(),
  mockClaimNextQueuedVisionAttachment: vi.fn(),
  mockRequeueStaleVisionAttachments: vi.fn(),
  mockUpdateIngestedAttachmentById: vi.fn(),
  mockSummarizeImageAttachmentForRecall: vi.fn(),
}));

vi.mock('@/platform/files/file-handler', () => ({
  fetchDiscordAttachmentBytes: mockFetchDiscordAttachmentBytes,
}));

vi.mock('@/features/embeddings', () => ({
  deleteAttachmentChunks: mockDeleteAttachmentChunks,
  ingestAttachmentText: mockIngestAttachmentText,
}));

vi.mock('@/features/attachments/ingestedAttachmentRepo', () => ({
  claimNextQueuedVisionAttachment: mockClaimNextQueuedVisionAttachment,
  requeueStaleVisionAttachments: mockRequeueStaleVisionAttachments,
  updateIngestedAttachmentById: mockUpdateIngestedAttachmentById,
}));

vi.mock('@/features/attachments/imageAttachmentRecall', () => ({
  summarizeImageAttachmentForRecall: mockSummarizeImageAttachmentForRecall,
}));

import {
  __resetImageAttachmentRecallWorkerForTests,
  initImageAttachmentRecallWorker,
  queueImageAttachmentRecall,
} from '@/features/attachments/imageAttachmentRecallWorker';

async function flushWorker(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flushWorker();
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

describe('imageAttachmentRecallWorker', () => {
  const originalImageEnabled = config.FILE_INGEST_IMAGE_ENABLED;
  const originalTimeoutMs = config.FILE_INGEST_IMAGE_TIMEOUT_MS;

  beforeEach(() => {
    __resetImageAttachmentRecallWorkerForTests();
    config.FILE_INGEST_IMAGE_ENABLED = true;
    config.FILE_INGEST_IMAGE_TIMEOUT_MS = 5_000;

    mockFetchDiscordAttachmentBytes.mockReset();
    mockDeleteAttachmentChunks.mockReset();
    mockIngestAttachmentText.mockReset();
    mockClaimNextQueuedVisionAttachment.mockReset();
    mockRequeueStaleVisionAttachments.mockReset();
    mockUpdateIngestedAttachmentById.mockReset();
    mockSummarizeImageAttachmentForRecall.mockReset();

    mockRequeueStaleVisionAttachments.mockResolvedValue(0);
    mockDeleteAttachmentChunks.mockResolvedValue(undefined);
    mockIngestAttachmentText.mockResolvedValue(undefined);
    mockUpdateIngestedAttachmentById.mockResolvedValue(undefined);
  });

  afterEach(() => {
    config.FILE_INGEST_IMAGE_ENABLED = originalImageEnabled;
    config.FILE_INGEST_IMAGE_TIMEOUT_MS = originalTimeoutMs;
  });

  it('requeues stale processing work during initialization', async () => {
    mockRequeueStaleVisionAttachments.mockResolvedValueOnce(2);
    mockClaimNextQueuedVisionAttachment.mockResolvedValueOnce(null);

    initImageAttachmentRecallWorker();
    await flushWorker();

    expect(mockRequeueStaleVisionAttachments).toHaveBeenCalled();
  });

  it('processes queued image attachments and indexes recall text', async () => {
    mockClaimNextQueuedVisionAttachment
      .mockResolvedValueOnce({
        id: 'att-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'msg-1',
        attachmentIndex: 0,
        filename: 'meme.png',
        sourceUrl: 'https://cdn.discordapp.com/meme.png',
        contentType: 'image/png',
        declaredSizeBytes: 1234,
        readSizeBytes: null,
        extractor: 'vision',
        status: 'processing',
        errorText: null,
        extractedText: null,
        extractedTextChars: 0,
        createdAt: new Date('2026-03-07T00:00:00.000Z'),
        updatedAt: new Date('2026-03-07T00:00:00.000Z'),
      })
      .mockResolvedValueOnce(null);
    mockFetchDiscordAttachmentBytes.mockResolvedValueOnce({
      kind: 'ok',
      buffer: Buffer.from([1, 2, 3]),
      mimeType: 'image/png',
      byteLength: 3,
    });
    mockSummarizeImageAttachmentForRecall.mockResolvedValueOnce({
      text: 'Image summary: cat meme\n\nVisible text: hello',
      summaryText: 'cat meme',
      visibleText: 'hello',
    });

    queueImageAttachmentRecall();
    await flushWorker();
    await waitForAssertion(() => {
      expect(mockFetchDiscordAttachmentBytes).toHaveBeenCalled();
    });

    expect(mockFetchDiscordAttachmentBytes).toHaveBeenCalledWith(
      'https://cdn.discordapp.com/meme.png',
      'meme.png',
      expect.objectContaining({
        allowImages: true,
      }),
    );
    expect(mockUpdateIngestedAttachmentById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'att-1',
        status: 'ok',
        extractor: 'vision',
        extractedText: 'Image summary: cat meme\n\nVisible text: hello',
      }),
    );
  });

  it('marks queued attachments as skip when Florence returns no recall text', async () => {
    mockClaimNextQueuedVisionAttachment
      .mockResolvedValueOnce({
        id: 'att-2',
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'msg-2',
        attachmentIndex: 0,
        filename: 'blank.png',
        sourceUrl: 'https://cdn.discordapp.com/blank.png',
        contentType: 'image/png',
        declaredSizeBytes: 1234,
        readSizeBytes: null,
        extractor: 'vision',
        status: 'processing',
        errorText: null,
        extractedText: null,
        extractedTextChars: 0,
        createdAt: new Date('2026-03-07T00:00:00.000Z'),
        updatedAt: new Date('2026-03-07T00:00:00.000Z'),
      })
      .mockResolvedValueOnce(null);
    mockFetchDiscordAttachmentBytes.mockResolvedValueOnce({
      kind: 'ok',
      buffer: Buffer.from([1, 2, 3]),
      mimeType: 'image/png',
      byteLength: 3,
    });
    mockSummarizeImageAttachmentForRecall.mockResolvedValueOnce({
      text: null,
      summaryText: '',
      visibleText: '',
    });

    queueImageAttachmentRecall();
    await flushWorker();
    await waitForAssertion(() => {
      expect(mockUpdateIngestedAttachmentById).toHaveBeenCalled();
    });

    expect(mockUpdateIngestedAttachmentById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'att-2',
        status: 'skip',
        extractor: 'vision',
      }),
    );
    expect(mockDeleteAttachmentChunks).not.toHaveBeenCalled();
    expect(mockIngestAttachmentText).not.toHaveBeenCalled();
  });
});
