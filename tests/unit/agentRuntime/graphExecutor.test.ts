import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAgentGraph } from '../../../src/core/agentRuntime/graphExecutor';
import {
  buildLinearExpertGraph,
  buildPlannedExpertGraph,
} from '../../../src/core/agentRuntime/plannerAgent';

const mockRunExperts = vi.hoisted(() => vi.fn());

vi.mock('../../../src/core/orchestration/runExperts', () => ({
  runExperts: mockRunExperts,
}));

vi.mock('../../../src/core/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('graphExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes a linear graph and writes blackboard artifacts', async () => {
    mockRunExperts.mockImplementation(async ({ experts }: { experts: string[] }) => [
      {
        name: experts[0],
        content: `${experts[0]} packet`,
        tokenEstimate: 10,
      },
    ]);

    const graph = buildLinearExpertGraph({
      routeKind: 'chat',
      experts: ['Memory', 'SocialGraph'],
      skipMemory: false,
    });

    const result = await executeAgentGraph({
      traceId: 'trace-graph-1',
      graph,
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1',
      userText: 'hello',
    });

    expect(result.packets).toHaveLength(2);
    expect(result.blackboard.artifacts).toHaveLength(2);
    expect(result.blackboard.counters.completedTasks).toBe(2);
    expect(result.blackboard.counters.failedTasks).toBe(0);
    expect(result.nodeRuns).toHaveLength(2);
    expect(result.nodeRuns.every((run) => run.status === 'ok')).toBe(true);
    expect(result.events.some((event) => event.type === 'graph_started')).toBe(true);
    expect(result.events.some((event) => event.type === 'graph_completed')).toBe(true);
  });

  it('records node failure and continues downstream execution', async () => {
    mockRunExperts
      .mockRejectedValueOnce(new Error('memory failed'))
      .mockResolvedValueOnce([
        {
          name: 'SocialGraph',
          content: 'social packet',
          tokenEstimate: 12,
        },
      ]);

    const graph = buildLinearExpertGraph({
      routeKind: 'chat',
      experts: ['Memory', 'SocialGraph'],
      skipMemory: false,
    });

    const result = await executeAgentGraph({
      traceId: 'trace-graph-2',
      graph,
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1',
      userText: 'hello',
    });

    expect(result.blackboard.counters.failedTasks).toBe(1);
    expect(result.blackboard.counters.completedTasks).toBe(1);
    expect(result.packets).toHaveLength(1);
    expect(result.nodeRuns).toHaveLength(2);
    expect(result.nodeRuns.some((run) => run.status === 'fatal_error')).toBe(true);
    expect(result.events.some((event) => event.type === 'node_failed')).toBe(true);
    expect(result.events.some((event) => event.type === 'node_completed')).toBe(true);
  });

  it('runs ready nodes in parallel for fanout graphs', async () => {
    mockRunExperts.mockImplementation(async ({ experts }: { experts: string[] }) => {
      await new Promise((resolve) => setTimeout(resolve, 70));
      return [
        {
          name: experts[0],
          content: `${experts[0]} packet`,
          tokenEstimate: 10,
        },
      ];
    });

    const graph = buildPlannedExpertGraph({
      routeKind: 'manage',
      experts: ['Memory', 'SocialGraph', 'VoiceAnalytics'],
      skipMemory: false,
      enableParallel: true,
    });

    const startedAt = Date.now();
    const result = await executeAgentGraph({
      traceId: 'trace-graph-3',
      graph,
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1',
      userText: 'hello',
    });
    const elapsedMs = Date.now() - startedAt;

    expect(result.packets).toHaveLength(3);
    expect(elapsedMs).toBeLessThan(220);
  });

  it('respects maxParallel execution limits', async () => {
    mockRunExperts.mockImplementation(async ({ experts }: { experts: string[] }) => {
      await new Promise((resolve) => setTimeout(resolve, 65));
      return [
        {
          name: experts[0],
          content: `${experts[0]} packet`,
          tokenEstimate: 10,
        },
      ];
    });

    const graph = buildPlannedExpertGraph({
      routeKind: 'manage',
      experts: ['Memory', 'SocialGraph', 'VoiceAnalytics'],
      skipMemory: false,
      enableParallel: true,
    });

    const startedAt = Date.now();
    await executeAgentGraph({
      traceId: 'trace-graph-4',
      graph,
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1',
      userText: 'hello',
      maxParallel: 1,
    });
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeGreaterThan(170);
  });
});
