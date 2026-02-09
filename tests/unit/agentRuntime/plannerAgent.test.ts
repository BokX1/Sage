import { describe, expect, it } from 'vitest';
import {
  buildContextGraph,
  buildLinearContextGraph,
} from '../../../src/core/agentRuntime/graphBuilder';

describe('graphBuilder', () => {
  it('omits Memory when skipMemory is enabled', () => {
    const graph = buildLinearContextGraph({
      agentKind: 'chat',
      providers: ['Memory', 'SocialGraph'],
      skipMemory: true,
    });

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].agent).toBe('SocialGraph');
  });

  it('creates deterministic linear dependencies', () => {
    const graph = buildLinearContextGraph({
      agentKind: 'chat',
      providers: ['Memory', 'Summarizer', 'SocialGraph'],
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
    const graph = buildContextGraph({
      agentKind: 'chat',
      providers: ['Memory', 'SocialGraph', 'VoiceAnalytics'],
      skipMemory: false,
      enableParallel: true,
    });

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes.every((node) => node.dependsOn.length === 0)).toBe(true);
    expect(graph.nodes.every((node) => node.metadata?.strategy === 'fanout')).toBe(true);
  });

  it('uses linear planning when parallel mode is disabled', () => {
    const graph = buildContextGraph({
      agentKind: 'chat',
      providers: ['Memory', 'SocialGraph', 'VoiceAnalytics'],
      skipMemory: false,
      enableParallel: false,
    });

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toEqual([
      { from: graph.nodes[0].id, to: graph.nodes[1].id },
      { from: graph.nodes[1].id, to: graph.nodes[2].id },
    ]);
    expect(graph.nodes.every((node) => node.metadata?.strategy === 'linear')).toBe(true);
  });

  it('propagates skipMemory in planned graph mode', () => {
    const graph = buildContextGraph({
      agentKind: 'chat',
      providers: ['Memory', 'SocialGraph', 'VoiceAnalytics'],
      skipMemory: true,
      enableParallel: true,
    });

    expect(graph.nodes.map((node) => node.agent)).toEqual(['SocialGraph', 'VoiceAnalytics']);
  });
});
