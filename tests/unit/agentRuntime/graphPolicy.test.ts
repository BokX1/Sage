import { describe, expect, it } from 'vitest';
import { validateAgentGraph } from '../../../src/core/agentRuntime/graphPolicy';
import { AgentGraph } from '../../../src/core/agentRuntime/agent-types';

function baseGraph(): AgentGraph {
  return {
    version: 'v1',
    routeKind: 'chat',
    createdAt: new Date().toISOString(),
    nodes: [
      {
        id: 'memory-1',
        agent: 'Memory',
        objective: 'memory',
        inputs: ['user_input'],
        successCriteria: ['returns_context_packet'],
        budget: {
          maxLatencyMs: 8_000,
          maxRetries: 0,
          maxInputTokens: 1_000,
          maxOutputTokens: 1_000,
        },
        dependsOn: [],
      },
      {
        id: 'social-1',
        agent: 'SocialGraph',
        objective: 'social',
        inputs: ['node:memory-1'],
        successCriteria: ['returns_context_packet'],
        budget: {
          maxLatencyMs: 8_000,
          maxRetries: 1,
          maxInputTokens: 1_000,
          maxOutputTokens: 1_000,
        },
        dependsOn: ['memory-1'],
      },
    ],
    edges: [{ from: 'memory-1', to: 'social-1' }],
  };
}

describe('graphPolicy', () => {
  it('accepts a valid graph', () => {
    const result = validateAgentGraph(baseGraph());
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing edge/dependency mapping', () => {
    const graph = baseGraph();
    graph.edges = [];

    const result = validateAgentGraph(graph);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('Missing edge for dependency'))).toBe(true);
  });

  it('rejects unknown dependencies', () => {
    const graph = baseGraph();
    graph.nodes[1].dependsOn = ['missing-node'];
    graph.edges = [{ from: 'missing-node', to: 'social-1' }];

    const result = validateAgentGraph(graph);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('depends on unknown node'))).toBe(true);
  });
});
