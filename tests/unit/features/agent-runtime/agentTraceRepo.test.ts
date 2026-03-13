import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUpsert, mockUpdate, mockFindUnique, mockFindMany } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockFindUnique: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock('@/platform/db/prisma-client', () => ({
  prisma: {
    agentTrace: {
      upsert: mockUpsert,
      update: mockUpdate,
      findUnique: mockFindUnique,
      findMany: mockFindMany,
    },
  },
}));

import {
  upsertTraceStart,
  updateTraceEnd,
  getTraceById,
  listRecentTraces,
} from '@/features/agent-runtime/agent-trace-repo';

describe('AgentTraceRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('upsertTraceStart', () => {
    it('creates or updates trace start row', async () => {
      mockUpsert.mockResolvedValue({});

      await upsertTraceStart({
        id: 'trace-123',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'user-1',
        routeKind: 'single',
      });

      expect(mockUpsert).toHaveBeenCalledWith({
        where: { id: 'trace-123' },
        create: expect.objectContaining({
          id: 'trace-123',
          routeKind: 'single',
        }),
        update: expect.objectContaining({
          routeKind: 'single',
        }),
      });
      expect(mockUpsert.mock.calls[0]?.[0].create).not.toHaveProperty('reasoningText');
      expect(mockUpsert.mock.calls[0]?.[0].update).not.toHaveProperty('reasoningText');
    });

    it('persists compact runtime metadata without legacy event payloads', async () => {
      mockUpsert.mockResolvedValue({});

      await upsertTraceStart({
        id: 'trace-start',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'user-1',
        routeKind: 'single',
        tokenJson: { baseline: 1 },
        budgetJson: { route: 'single' },
        langSmithRunId: 'run-1',
        langSmithTraceId: 'trace-1',
      });

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            budgetJson: expect.any(Object),
            tokenJson: { baseline: 1 },
            langSmithRunId: 'run-1',
            langSmithTraceId: 'trace-1',
          }),
          update: expect.objectContaining({
            budgetJson: expect.any(Object),
            tokenJson: { baseline: 1 },
            langSmithRunId: 'run-1',
            langSmithTraceId: 'trace-1',
          }),
        }),
      );
    });

    it('propagates trace start write failures', async () => {
      mockUpsert.mockRejectedValueOnce(new Error('P2022 column does not exist'));

      await expect(
        upsertTraceStart({
          id: 'trace-write-error',
          guildId: 'guild-1',
          channelId: 'channel-1',
          userId: 'user-1',
          routeKind: 'single',
        }),
      ).rejects.toThrow('P2022 column does not exist');

      expect(mockUpsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateTraceEnd', () => {
    it('updates trace with final reply', async () => {
      mockUpdate.mockResolvedValue({});

      await updateTraceEnd({
        id: 'trace-123',
        replyText: 'Final reply text',
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'trace-123' },
        data: expect.objectContaining({
          approvalRequestId: null,
          graphStatus: null,
          langSmithRunId: null,
          langSmithTraceId: null,
          parentTraceId: null,
          replyText: 'Final reply text',
          terminationReason: null,
          threadId: null,
        }),
      });
      expect(mockUpdate.mock.calls[0]?.[0].data).not.toHaveProperty('reasoningText');
    });

    it('persists tool, budget, and LangSmith references when provided', async () => {
      mockUpdate.mockResolvedValue({});

      await updateTraceEnd({
        id: 'trace-123',
        toolJson: { executed: true },
        budgetJson: { toolResultCount: 2 },
        tokenJson: { promptTokens: 10 },
        langSmithRunId: 'run-2',
        langSmithTraceId: 'trace-2',
        terminationReason: 'assistant_reply',
        replyText: 'Final reply text',
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'trace-123' },
        data: expect.objectContaining({
          replyText: 'Final reply text',
          toolJson: { executed: true },
          budgetJson: expect.any(Object),
          tokenJson: { promptTokens: 10 },
          langSmithRunId: 'run-2',
          langSmithTraceId: 'trace-2',
          terminationReason: 'assistant_reply',
        }),
      });
    });

    it('propagates trace end write failures', async () => {
      mockUpdate.mockRejectedValueOnce(new Error('P2022 column does not exist'));

      await expect(
        updateTraceEnd({
          id: 'trace-end-write-error',
          budgetJson: { toolResultCount: 1 },
          replyText: 'Final reply text',
        }),
      ).rejects.toThrow('P2022 column does not exist');

      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('getTraceById', () => {
    it('fetches trace by id', async () => {
      const mockTrace = {
        id: 'trace-123',
        routeKind: 'single',
        createdAt: new Date(),
      };

      mockFindUnique.mockResolvedValue(mockTrace);

      const result = await getTraceById('trace-123');

      expect(result).toEqual(mockTrace);
      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { id: 'trace-123' },
      });
    });
  });

  describe('listRecentTraces', () => {
    it('lists recent traces for a guild', async () => {
      const mockTraces = [
        { id: 'trace-1', routeKind: 'single', createdAt: new Date() },
        { id: 'trace-2', routeKind: 'single', createdAt: new Date() },
      ];

      mockFindMany.mockResolvedValue(mockTraces);

      const result = await listRecentTraces({ guildId: 'guild-1', limit: 5 });

      expect(result).toHaveLength(2);
      expect(mockFindMany).toHaveBeenCalledWith({
        where: { guildId: 'guild-1' },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
    });

    it('lists traces for a channel', async () => {
      mockFindMany.mockResolvedValue([]);

      await listRecentTraces({ channelId: 'channel-1', limit: 10 });

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { channelId: 'channel-1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    });
  });
});
