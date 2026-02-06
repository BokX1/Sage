import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('relationshipGraph', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('updateFromMessage', () => {
    it('should create new edge with mention signal', async () => {
      // Mock the repo - now using findEdgesBatch for batch queries
      const mockFindEdgesBatch = vi.fn().mockResolvedValue(new Map());
      const mockUpsertEdge = vi.fn().mockResolvedValue(undefined);

      vi.doMock('../../../src/core/relationships/relationshipEdgeRepo', () => ({
        findEdge: vi.fn(),
        findEdgesBatch: mockFindEdgesBatch,
        upsertEdge: mockUpsertEdge,
        findEdgesForUser: vi.fn(),
        findTopEdges: vi.fn(),
      }));

      const { updateFromMessage } =
        await import('../../../src/core/relationships/relationshipGraph');

      await updateFromMessage({
        guildId: 'guild1',
        authorId: 'user_a',
        mentionedUserIds: ['user_b'],
        now: new Date('2024-01-01T00:00:00Z'),
      });

      expect(mockUpsertEdge).toHaveBeenCalled();
      const call = mockUpsertEdge.mock.calls[0][0];
      expect(call.weight).toBeGreaterThan(0);
      expect(call.confidence).toBeGreaterThan(0);
      expect(call.featuresJson.mentions.count).toBe(1);
    });

    it('should increment existing edge with mention signal', async () => {
      const existingEdge = {
        guildId: 'guild1',
        userA: 'user_a',
        userB: 'user_b',
        weight: 0.1,
        confidence: 0.1,
        featuresJson: {
          mentions: { count: 1, lastAt: Date.parse('2024-01-01T00:00:00Z') },
          replies: { count: 0, lastAt: Date.parse('2024-01-01T00:00:00Z') },
          voice: { overlapMs: 0, lastAt: Date.parse('2024-01-01T00:00:00Z') },
          meta: { lastComputedAt: Date.parse('2024-01-01T00:00:00Z') },
        },
        manualOverride: null,
      };

      // Return edge in a Map keyed by "userA:userB"
      const edgeMap = new Map([['user_a:user_b', existingEdge]]);
      const mockFindEdgesBatch = vi.fn().mockResolvedValue(edgeMap);
      const mockUpsertEdge = vi.fn().mockResolvedValue(undefined);

      vi.doMock('../../../src/core/relationships/relationshipEdgeRepo', () => ({
        findEdge: vi.fn(),
        findEdgesBatch: mockFindEdgesBatch,
        upsertEdge: mockUpsertEdge,
        findEdgesForUser: vi.fn(),
        findTopEdges: vi.fn(),
      }));

      const { updateFromMessage } =
        await import('../../../src/core/relationships/relationshipGraph');

      await updateFromMessage({
        guildId: 'guild1',
        authorId: 'user_a',
        mentionedUserIds: ['user_b'],
        now: new Date('2024-01-02T00:00:00Z'),
      });

      const call = mockUpsertEdge.mock.calls[0][0];
      expect(call.featuresJson.mentions.count).toBe(2);
      expect(call.weight).toBeGreaterThan(existingEdge.weight);
    });

    it('should skip self-mentions', async () => {
      const mockFindEdgesBatch = vi.fn().mockResolvedValue(new Map());
      const mockUpsertEdge = vi.fn();

      vi.doMock('../../../src/core/relationships/relationshipEdgeRepo', () => ({
        findEdge: vi.fn(),
        findEdgesBatch: mockFindEdgesBatch,
        upsertEdge: mockUpsertEdge,
        findEdgesForUser: vi.fn(),
        findTopEdges: vi.fn(),
      }));

      const { updateFromMessage } =
        await import('../../../src/core/relationships/relationshipGraph');

      await updateFromMessage({
        guildId: 'guild1',
        authorId: 'user_a',
        mentionedUserIds: ['user_a'], // Self-mention
        now: new Date('2024-01-01T00:00:00Z'),
      });

      expect(mockUpsertEdge).not.toHaveBeenCalled();
    });
  });

  describe('manualOverride', () => {
    it('should set weight and confidence to manual values', async () => {
      const mockFindEdge = vi.fn().mockResolvedValue(null);
      const mockUpsertEdge = vi.fn().mockResolvedValue(undefined);

      vi.doMock('../../../src/core/relationships/relationshipEdgeRepo', () => ({
        findEdge: mockFindEdge,
        findEdgesBatch: vi.fn().mockResolvedValue(new Map()),
        upsertEdge: mockUpsertEdge,
        findEdgesForUser: vi.fn(),
        findTopEdges: vi.fn(),
      }));

      const { setManualRelationship } =
        await import('../../../src/core/relationships/relationshipGraph');

      await setManualRelationship({
        guildId: 'guild1',
        user1: 'user_a',
        user2: 'user_b',
        level0to1: 0.75,
      });

      const call = mockUpsertEdge.mock.calls[0][0];
      expect(call.weight).toBe(0.75);
      expect(call.confidence).toBe(1.0);
      expect(call.manualOverride).toBe(0.75);
    });
  });
});
