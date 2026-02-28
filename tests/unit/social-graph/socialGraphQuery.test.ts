import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRun = vi.hoisted(() => vi.fn());
const mockClose = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/social-graph/memgraphClient', () => ({
  createMemgraphClient: () => ({
    run: mockRun,
    close: mockClose,
  }),
}));

describe('querySocialGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses guild-scoped filters and an integer LIMIT parameter for Memgraph', async () => {
    mockRun
      .mockResolvedValueOnce({
        records: [
          {
            get: (key: string) => {
              const map: Record<string, unknown> = {
                other_id: 'user-2',
                outgoing_count: 4,
                incoming_count: 1,
                reciprocity: 0.25,
                avg_sentiment: 0.1,
                mention_count: 2,
                reply_count: 1,
                react_count: 1,
                voice_count: 1,
              };
              if (key in map) return map[key];
              return null;
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        records: [
          {
            get: (key: string) => {
              const map: Record<string, unknown> = {
                user_id: 'user-1',
                guild_pagerank: 0.5,
                guild_community_id: 2,
              };
              if (key in map) return map[key];
              return null;
            },
          },
          {
            get: (key: string) => {
              const map: Record<string, unknown> = {
                user_id: 'user-2',
                guild_pagerank: 0.2,
                guild_community_id: 3,
              };
              if (key in map) return map[key];
              return null;
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        records: [
          {
            get: (key: string) => {
              if (key === 'other_id') return 'user-2';
              if (key === 'last_ts') return '2024-01-01T00:00:00.000Z';
              return null;
            },
          },
        ],
      });

    const { querySocialGraph } = await import('@/social-graph/socialGraphQuery');
    const result = await querySocialGraph('guild-1', 'user-1', 12.8);

    expect(result).not.toBeNull();
    expect(result?.userPagerank).toBe(0.5);
    expect(result?.userCommunityId).toBe(2);
    expect(mockRun).toHaveBeenCalledTimes(3);

    const firstCallQuery = mockRun.mock.calls[0]?.[0] as string;
    const firstCallParams = mockRun.mock.calls[0]?.[1] as {
      guildId: string;
      userId: string;
      limit: { toNumber: () => number };
    };
    const secondCallQuery = mockRun.mock.calls[1]?.[0] as string;
    const secondCallParams = mockRun.mock.calls[1]?.[1] as {
      guildId: string;
      userIds: string[];
    };

    expect(firstCallQuery).toContain('r.guild_id = $guildId');
    expect(firstCallQuery).toContain('OPTIONAL MATCH (otherIn:User)-[rIn:INTERACTED]->(u)');
    expect(firstCallQuery).toContain('collect(DISTINCT otherIn) AS in_others');
    expect(firstCallQuery).toContain('out_others + in_others + collect(DISTINCT otherVoice) AS raw_others');
    expect(firstCallQuery).toContain('(u)-[v:VOICE_SESSION]-(other)');
    expect(firstCallQuery).toContain('WHEN v IS NULL THEN NULL');
    expect(firstCallQuery).toContain('AS voice_count');
    expect(firstCallQuery).not.toContain('coalesce(u.pagerank');

    expect(secondCallQuery).toContain('membership:ACTIVE_IN_GUILD');
    expect(secondCallQuery).toContain('UNWIND $userIds AS scoped_user_id');
    expect(secondCallQuery).toContain('guild_pagerank');
    expect(secondCallParams.guildId).toBe('guild-1');
    expect(secondCallParams.userIds.sort()).toEqual(['user-1', 'user-2']);

    expect(firstCallParams.guildId).toBe('guild-1');
    expect(firstCallParams.userId).toBe('user-1');
    expect(typeof firstCallParams.limit?.toNumber).toBe('function');
    expect(firstCallParams.limit.toNumber()).toBe(12);
  });

  it('returns inbound-only relationship edges emitted by the guild-scoped query', async () => {
    mockRun
      .mockResolvedValueOnce({
        records: [
          {
            get: (key: string) => {
              const map: Record<string, unknown> = {
                other_id: 'user-inbound',
                outgoing_count: 0,
                incoming_count: 3,
                reciprocity: 0,
                avg_sentiment: 0,
                mention_count: 0,
                reply_count: 0,
                react_count: 0,
                voice_count: 0,
              };
              if (key in map) return map[key];
              return null;
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        records: [
          {
            get: (key: string) => {
              const map: Record<string, unknown> = {
                user_id: 'user-1',
                guild_pagerank: 0.7,
                guild_community_id: 8,
              };
              if (key in map) return map[key];
              return null;
            },
          },
          {
            get: (key: string) => {
              const map: Record<string, unknown> = {
                user_id: 'user-inbound',
                guild_pagerank: 0.4,
                guild_community_id: 2,
              };
              if (key in map) return map[key];
              return null;
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        records: [
          {
            get: (key: string) => {
              if (key === 'other_id') return 'user-inbound';
              if (key === 'last_ts') return '2024-01-05T00:00:00.000Z';
              return null;
            },
          },
        ],
      });

    const { querySocialGraph } = await import('@/social-graph/socialGraphQuery');
    const result = await querySocialGraph('guild-1', 'user-1', 10);

    expect(result).not.toBeNull();
    expect(result?.totalConnections).toBe(1);
    expect(result?.edges[0]).toMatchObject({
      userId: 'user-inbound',
      outgoingCount: 0,
      incomingCount: 3,
      pagerank: 0.4,
      communityId: 2,
    });
    expect(mockRun).toHaveBeenCalledTimes(3);
  });
});
