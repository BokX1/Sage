import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAgentGraph } from '../../../src/core/agentRuntime/graphExecutor';
import {
  buildContextGraph,
  buildLinearContextGraph,
} from '../../../src/core/agentRuntime/graphBuilder';

const mockRunContextProviders = vi.hoisted(() => vi.fn());

vi.mock('../../../src/core/context/runContext', () => ({
  runContextProviders: mockRunContextProviders,
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
    mockRunContextProviders.mockImplementation(async ({ providers }: { providers: string[] }) => [
      {
        name: providers[0],
        content: `${providers[0]} packet`,
        tokenEstimate: 10,
      },
    ]);

    const graph = buildLinearContextGraph({
      agentKind: 'chat',
      providers: ['UserMemory', 'SocialGraph'],
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
    mockRunContextProviders
      .mockRejectedValueOnce(new Error('memory failed'))
      .mockResolvedValueOnce([
        {
          name: 'SocialGraph',
          content: 'social packet',
          tokenEstimate: 12,
        },
      ]);

    const graph = buildLinearContextGraph({
      agentKind: 'chat',
      providers: ['UserMemory', 'SocialGraph'],
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
    mockRunContextProviders.mockImplementation(async ({ providers }: { providers: string[] }) => {
      await new Promise((resolve) => setTimeout(resolve, 70));
      return [
        {
          name: providers[0],
          content: `${providers[0]} packet`,
          tokenEstimate: 10,
        },
      ];
    });

    const graph = buildContextGraph({
      agentKind: 'chat',
      providers: ['UserMemory', 'SocialGraph', 'VoiceAnalytics'],
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

    expect(result.packets).toHaveLength(4);
    expect(result.packets.map((packet) => packet.name)).toEqual([
      'UserMemory',
      'ChannelMemory',
      'SocialGraph',
      'VoiceAnalytics',
    ]);
    expect(elapsedMs).toBeLessThan(220);
  });

  it('respects maxParallel execution limits', async () => {
    mockRunContextProviders.mockImplementation(async ({ providers }: { providers: string[] }) => {
      await new Promise((resolve) => setTimeout(resolve, 65));
      return [
        {
          name: providers[0],
          content: `${providers[0]} packet`,
          tokenEstimate: 10,
        },
      ];
    });

    const graph = buildContextGraph({
      agentKind: 'chat',
      providers: ['UserMemory', 'SocialGraph', 'VoiceAnalytics'],
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
