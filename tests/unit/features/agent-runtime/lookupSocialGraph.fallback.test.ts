import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importFresh } from '../../../testkit/importFresh';

const mockQuerySocialGraph = vi.hoisted(() => vi.fn());

vi.mock('@/features/social-graph/socialGraphQuery', () => ({
  querySocialGraph: mockQuerySocialGraph,
}));

describe('lookupSocialGraph fallback behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns unavailable when Memgraph query fails', async () => {
    mockQuerySocialGraph.mockRejectedValueOnce(new Error('memgraph unavailable'));

    const { lookupSocialGraph } = await importFresh(() => import('@/features/agent-runtime/toolIntegrations'));
    const result = await lookupSocialGraph({
      guildId: 'guild-1',
      userId: 'user-a',
      maxEdges: 5,
      maxChars: 2_000,
    });

    const typedResult = result as Record<string, unknown>;
    expect(typedResult.found).toBe(false);
    expect(typedResult.source).toBe('memgraph');
    expect(String(typedResult.content)).toContain('temporarily unavailable');
  });

  it('keeps Memgraph as primary source when query succeeds', async () => {
    mockQuerySocialGraph.mockResolvedValueOnce({
      userPagerank: 0.91,
      userCommunityId: 3,
      totalConnections: 1,
      edges: [
        {
          userId: 'user-b',
          outgoingCount: 3,
          incomingCount: 1,
          dunbarLayer: 1,
          dunbarLabel: 'intimate',
          reciprocity: 0.33,
          pagerank: 0.5,
          communityId: 3,
          avgSentiment: 0.4,
          interactionBreakdown: {
            mentions: 2,
            replies: 1,
            reacts: 0,
            voiceSessions: 1,
          },
          lastInteractionAt: '2024-01-03T00:00:00.000Z',
        },
      ],
    });

    const { lookupSocialGraph } = await importFresh(() => import('@/features/agent-runtime/toolIntegrations'));
    const result = await lookupSocialGraph({
      guildId: 'guild-1',
      userId: 'user-a',
      maxEdges: 5,
    });

    const typedResult = result as Record<string, unknown>;
    expect(typedResult.found).toBe(true);
    expect(typedResult.source).toBe('memgraph');
  });
});
