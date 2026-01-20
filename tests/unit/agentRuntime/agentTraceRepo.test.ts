import { Prisma } from '@prisma/client';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma - use vi.hoisted to avoid hoisting issues
const { mockUpsert, mockUpdate, mockFindUnique, mockFindMany } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockFindUnique: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock('../../../src/db/client', () => ({
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
} from '../../../src/core/trace/agentTraceRepo';

describe('AgentTraceRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('upsertTraceStart', () => {
    it('should create or update trace start row', async () => {
      mockUpsert.mockResolvedValue({});

      await upsertTraceStart({
        id: 'trace-123',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'user-1',
        routeKind: 'qa',
        routerJson: { kind: 'qa', temperature: 0.7 },
        expertsJson: [{ name: 'Memory' }],
      });

      expect(mockUpsert).toHaveBeenCalledWith({
        where: { id: 'trace-123' },
        create: expect.objectContaining({
          id: 'trace-123',
          routeKind: 'qa',
        }),
        update: expect.objectContaining({
          routeKind: 'qa',
        }),
      });
    });
  });

  describe('updateTraceEnd', () => {
    it('should update trace with governor and final reply', async () => {
      mockUpdate.mockResolvedValue({});

      await updateTraceEnd({
        id: 'trace-123',
        replyText: 'Final reply text',
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'trace-123' },
        data: {
          replyText: 'Final reply text',
          toolJson: Prisma.JsonNull,
        },
      });
    });
  });

  describe('getTraceById', () => {
    it('should fetch trace by ID', async () => {
      const mockTrace = {
        id: 'trace-123',
        routeKind: 'summarize',
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
    it('should list recent traces for a guild', async () => {
      const mockTraces = [
        { id: 'trace-1', routeKind: 'qa', createdAt: new Date() },
        { id: 'trace-2', routeKind: 'summarize', createdAt: new Date() },
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

    it('should list traces for a channel', async () => {
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
