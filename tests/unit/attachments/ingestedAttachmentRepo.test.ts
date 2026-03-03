/**
 * @module tests/unit/attachments/ingestedAttachmentRepo.test
 * @description Covers attachment repository normalization behavior.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpsert = vi.hoisted(() => vi.fn());
const mockFindMany = vi.hoisted(() => vi.fn());

vi.mock('../../../src/core/db/prisma-client', () => ({
  prisma: {
    ingestedAttachment: {
      upsert: mockUpsert,
      findMany: mockFindMany,
    },
  },
}));

import {
  findIngestedAttachmentsForLookup,
  findIngestedAttachmentsForLookupInGuild,
  listRecentIngestedAttachments,
  upsertIngestedAttachment,
} from '../../../src/core/attachments/ingestedAttachmentRepo';

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ia-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    messageId: 'message-1',
    attachmentIndex: 0,
    filename: 'file.txt',
    sourceUrl: 'https://example.com/file.txt',
    contentType: 'text/plain',
    declaredSizeBytes: 12,
    readSizeBytes: 12,
    extractor: 'text',
    status: 'ok',
    errorText: null,
    extractedText: 'hello',
    extractedTextChars: 5,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ingestedAttachmentRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue(makeRow());
    mockFindMany.mockResolvedValue([makeRow()]);
  });

  it('normalizes non-finite attachmentIndex to zero during upsert', async () => {
    await upsertIngestedAttachment({
      guildId: 'guild-1',
      channelId: 'channel-1',
      messageId: 'message-1',
      attachmentIndex: Number.NaN as unknown as number,
      filename: 'file.txt',
      sourceUrl: 'https://example.com/file.txt',
      status: 'ok',
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ attachmentIndex: 0 }),
        update: expect.objectContaining({ attachmentIndex: 0 }),
      }),
    );
  });

  it('falls back to safe list limit when listRecent limit is non-finite', async () => {
    await listRecentIngestedAttachments({
      guildId: 'guild-1',
      channelId: 'channel-1',
      limit: Number.NaN as unknown as number,
    });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1,
      }),
    );
  });

  it('falls back to safe lookup window when channel lookup limit is non-finite', async () => {
    mockFindMany.mockResolvedValue([
      makeRow({ id: 'ia-1' }),
      makeRow({
        id: 'ia-2',
        createdAt: new Date('2024-01-02T00:00:00.000Z'),
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      }),
    ]);

    const rows = await findIngestedAttachmentsForLookup({
      guildId: 'guild-1',
      channelId: 'channel-1',
      limit: Number.POSITIVE_INFINITY,
    });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 6,
      }),
    );
    expect(rows).toHaveLength(1);
  });

  it('falls back to safe lookup window when guild lookup limit is non-finite', async () => {
    await findIngestedAttachmentsForLookupInGuild({
      guildId: 'guild-1',
      limit: Number.NaN as unknown as number,
    });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 20,
      }),
    );
  });
});
