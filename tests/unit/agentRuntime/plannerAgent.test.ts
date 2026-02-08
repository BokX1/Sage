import { describe, expect, it } from 'vitest';
import {
  buildLinearExpertGraph,
  buildPlannedExpertGraph,
} from '../../../src/core/agentRuntime/plannerAgent';

describe('plannerAgent', () => {
  it('omits Memory when skipMemory is enabled', () => {
    const graph = buildLinearExpertGraph({
      routeKind: 'chat',
      experts: ['Memory', 'SocialGraph'],
      skipMemory: true,
    });

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].agent).toBe('SocialGraph');
  });

  it('creates deterministic linear dependencies', () => {
    const graph = buildLinearExpertGraph({
      routeKind: 'analyze',
      experts: ['Memory', 'Summarizer', 'SocialGraph'],
      skipMemory: false,
    });

    expect(graph.nodes.map((node) => node.agent)).toEqual(['Memory', 'Summarizer', 'SocialGraph']);
    expect(graph.edges).toEqual([
      { from: graph.nodes[0].id, to: graph.nodes[1].id },
      { from: graph.nodes[1].id, to: graph.nodes[2].id },
    ]);
    expect(graph.nodes[2].dependsOn).toEqual([graph.nodes[1].id]);
  });

  it('uses fanout planning when parallel mode is enabled', () => {
    const graph = buildPlannedExpertGraph({
      routeKind: 'manage',
      experts: ['Memory', 'SocialGraph', 'VoiceAnalytics'],
      skipMemory: false,
      enableParallel: true,
    });

    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[0].agent).toBe('Memory');
    expect(graph.nodes[0].dependsOn).toEqual([]);
    expect(graph.nodes[1].dependsOn).toEqual([graph.nodes[0].id]);
    expect(graph.nodes[2].dependsOn).toEqual([graph.nodes[0].id]);
    expect(graph.nodes.every((node) => node.metadata?.strategy === 'dependency_aware')).toBe(true);
  });

  it('uses fanout planning for routes not using dependency-aware strategy', () => {
    const graph = buildPlannedExpertGraph({
      routeKind: 'chat',
      experts: ['Memory', 'SocialGraph', 'VoiceAnalytics'],
      skipMemory: false,
      enableParallel: true,
    });

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes.every((node) => node.dependsOn.length === 0)).toBe(true);
    expect(graph.nodes.every((node) => node.metadata?.strategy === 'fanout')).toBe(true);
  });
});
