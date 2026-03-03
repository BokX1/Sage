import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRun = vi.hoisted(() => vi.fn());
const mockClose = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/social-graph/memgraphClient', () => ({
  createMemgraphClient: () => ({
    run: mockRun,
    close: mockClose,
  }),
}));

describe('runGraphAnalyticsPulse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses a peer-aware dedup key for VOICE_SESSION activity counts', async () => {
    mockRun.mockResolvedValue({ records: [] });
    mockRun.mockResolvedValueOnce({
      records: [
        {
          get: (key: string) => (key === 'c' ? 1 : null),
        },
      ],
    });

    const { runGraphAnalyticsPulse } = await import('@/social-graph/graphAnalyticsPulse');
    await runGraphAnalyticsPulse();

    const influenceQueryCall = mockRun.mock.calls.find(
      ([query]) =>
        typeof query === 'string' &&
        query.includes('SET active.guild_activity = out_count + in_count + voice_count'),
    );
    const influenceQuery = influenceQueryCall?.[0] as string | undefined;

    expect(influenceQuery).toBeDefined();
    expect(influenceQuery).toContain('OPTIONAL MATCH (u)-[v:VOICE_SESSION]-(voice_peer:User)');
    expect(influenceQuery).toContain(
      "coalesce(toString(v.ts), toString(id(v))) + ':' + coalesce(voice_peer.id, '')",
    );
    expect(influenceQuery).not.toContain('coalesce(v.ts, toString(id(v)))');
  });
});
