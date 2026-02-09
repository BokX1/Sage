import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateRecentTraceOutcomes } from '../../../src/core/agentRuntime/replayHarness';

const mockListRecentTraces = vi.hoisted(() => vi.fn());

vi.mock('../../../src/core/agentRuntime/agent-trace-repo', () => ({
  listRecentTraces: mockListRecentTraces,
}));

describe('replayHarness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes aggregated replay metrics', async () => {
    mockListRecentTraces.mockResolvedValue([
      {
        id: 'trace-1',
        routeKind: 'chat',
        replyText: 'Good answer',
        toolJson: { executed: true },
        qualityJson: { critic: [{ score: 0.9 }] },
        budgetJson: { failedTasks: 0 },
        tokenJson: {},
        createdAt: new Date('2026-02-08T00:00:00.000Z'),
      },
      {
        id: 'trace-2',
        routeKind: 'search',
        replyText: "I'm having trouble connecting right now. Please try again later.",
        toolJson: null,
        qualityJson: null,
        budgetJson: { failedTasks: 2 },
        tokenJson: {},
        createdAt: new Date('2026-02-08T00:01:00.000Z'),
      },
    ]);

    const report = await evaluateRecentTraceOutcomes({ limit: 10, guildId: 'guild-1' });

    expect(report.total).toBe(2);
    expect(report.rows).toHaveLength(2);
    expect(report.byRoute.chat.total).toBe(1);
    expect(report.byRoute.search.total).toBe(1);
    expect(report.successLikelyCount).toBe(1);
    expect(report.avgScore).toBeGreaterThan(0);
  });
});
