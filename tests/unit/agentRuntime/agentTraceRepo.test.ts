import { Prisma } from '@prisma/client';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma - use vi.hoisted to avoid hoisting issues
const { mockUpsert, mockUpdate, mockFindUnique, mockFindMany, mockAgentRunDeleteMany, mockAgentRunCreateMany } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockFindUnique: vi.fn(),
  mockFindMany: vi.fn(),
  mockAgentRunDeleteMany: vi.fn(),
  mockAgentRunCreateMany: vi.fn(),
}));

const mockLoggerWarn = vi.hoisted(() => vi.fn());

vi.mock('../../../src/core/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
  },
}));

vi.mock('../../../src/core/db/prisma-client', () => ({
  prisma: {
    agentTrace: {
      upsert: mockUpsert,
      update: mockUpdate,
      findUnique: mockFindUnique,
      findMany: mockFindMany,
    },
    agentRun: {
      deleteMany: mockAgentRunDeleteMany,
      createMany: mockAgentRunCreateMany,
    },
  },
}));

import {
  upsertTraceStart,
  updateTraceEnd,
  replaceAgentRuns,
  getTraceById,
  listRecentTraces,
} from '../../../src/core/agentRuntime/agent-trace-repo';

describe('AgentTraceRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentRunDeleteMany.mockResolvedValue({ count: 0 });
    mockAgentRunCreateMany.mockResolvedValue({ count: 0 });
  });

  describe('upsertTraceStart', () => {
    it('should create or update trace start row', async () => {
      mockUpsert.mockResolvedValue({});

      await upsertTraceStart({
        id: 'trace-123',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'user-1',
        routeKind: 'chat',
        routerJson: { kind: 'chat', temperature: 0.7 },
        expertsJson: [{ name: 'UserMemory' }],
      });

      expect(mockUpsert).toHaveBeenCalledWith({
        where: { id: 'trace-123' },
        create: expect.objectContaining({
          id: 'trace-123',
          routeKind: 'chat',
          reasoningText: null,
        }),
        update: expect.objectContaining({
          routeKind: 'chat',
          reasoningText: null,
        }),
      });
    });

    it('embeds agent graph/event metadata into tokenJson payload', async () => {
      mockUpsert.mockResolvedValue({});

      await upsertTraceStart({
        id: 'trace-graph',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'user-1',
        routeKind: 'chat',
        routerJson: { kind: 'chat' },
        expertsJson: [{ name: 'UserMemory' }],
        tokenJson: { baseline: 1 },
        agentGraphJson: { nodes: [{ id: 'memory-1' }] },
        agentEventsJson: [{ type: 'node_completed' }],
        budgetJson: { nodeCount: 1 },
      });

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            agentGraphJson: expect.any(Object),
            agentEventsJson: expect.any(Array),
            budgetJson: expect.any(Object),
            tokenJson: expect.objectContaining({
              baseline: 1,
              agentGraph: expect.any(Object),
              agentEvents: expect.any(Array),
              budget: expect.any(Object),
            }),
          }),
          update: expect.objectContaining({
            agentGraphJson: expect.any(Object),
            agentEventsJson: expect.any(Array),
            budgetJson: expect.any(Object),
            tokenJson: expect.objectContaining({
              baseline: 1,
              agentGraph: expect.any(Object),
              agentEvents: expect.any(Array),
              budget: expect.any(Object),
            }),
          }),
        }),
      );
    });

    it('falls back to legacy upsert on schema mismatch errors', async () => {
      mockUpsert
        .mockRejectedValueOnce(new Error('P2022 column does not exist'))
        .mockResolvedValueOnce({});

      await upsertTraceStart({
        id: 'trace-legacy-fallback',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'user-1',
        routeKind: 'chat',
        routerJson: { kind: 'chat' },
        expertsJson: [{ name: 'UserMemory' }],
        agentGraphJson: { nodes: [] },
      });

      expect(mockUpsert).toHaveBeenCalledTimes(2);
      const secondCall = mockUpsert.mock.calls[1][0];
      expect(secondCall.create.agentGraphJson).toBeUndefined();
      expect(secondCall.update.agentGraphJson).toBeUndefined();
      expect(mockLoggerWarn).toHaveBeenCalled();
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

    it('should persist quality and budget JSON when provided', async () => {
      mockUpdate.mockResolvedValue({});

      await updateTraceEnd({
        id: 'trace-123',
        toolJson: { executed: true },
        qualityJson: { critic: [{ score: 0.9 }] },
        budgetJson: { graphNodes: 2 },
        replyText: 'Final reply text',
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'trace-123' },
        data: expect.objectContaining({
          replyText: 'Final reply text',
          toolJson: { executed: true },
          qualityJson: expect.any(Object),
          budgetJson: expect.any(Object),
        }),
      });
    });

    it('falls back to legacy update on schema mismatch errors', async () => {
      mockUpdate
        .mockRejectedValueOnce(new Error('P2022 column does not exist'))
        .mockResolvedValueOnce({});

      await updateTraceEnd({
        id: 'trace-legacy-end',
        qualityJson: { score: 0.8 },
        budgetJson: { graphNodes: 1 },
        replyText: 'Final reply text',
      });

      expect(mockUpdate).toHaveBeenCalledTimes(2);
      const secondCall = mockUpdate.mock.calls[1][0];
      expect(secondCall.data.qualityJson).toBeUndefined();
      expect(secondCall.data.budgetJson).toBeUndefined();
      expect(mockLoggerWarn).toHaveBeenCalled();
    });
  });

  describe('replaceAgentRuns', () => {
    it('replaces all rows for a trace', async () => {
      await replaceAgentRuns('trace-1', [
        {
          traceId: 'trace-1',
          nodeId: 'memory-1',
          agent: 'UserMemory',
          status: 'ok',
          attempts: 1,
          startedAt: '2026-02-08T00:00:00.000Z',
          finishedAt: '2026-02-08T00:00:01.000Z',
          latencyMs: 1000,
        },
      ]);

      expect(mockAgentRunDeleteMany).toHaveBeenCalledWith({
        where: { traceId: 'trace-1' },
      });
      expect(mockAgentRunCreateMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            traceId: 'trace-1',
            nodeId: 'memory-1',
            agent: 'UserMemory',
            status: 'ok',
            attempts: 1,
            latencyMs: 1000,
          }),
        ],
      });
    });

    it('logs and continues on AgentRun write failure', async () => {
      mockAgentRunCreateMany.mockRejectedValueOnce(new Error('db unavailable'));

      await replaceAgentRuns('trace-2', [
        {
          traceId: 'trace-2',
          nodeId: 'memory-1',
          agent: 'UserMemory',
          status: 'ok',
          attempts: 1,
          startedAt: '2026-02-08T00:00:00.000Z',
        },
      ]);

      expect(mockLoggerWarn).toHaveBeenCalled();
    });
  });
  describe('getTraceById', () => {
    it('should fetch trace by ID', async () => {
      const mockTrace = {
        id: 'trace-123',
        routeKind: 'analyze',
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
        { id: 'trace-1', routeKind: 'chat', createdAt: new Date() },
        { id: 'trace-2', routeKind: 'analyze', createdAt: new Date() },
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
