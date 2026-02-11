import { describe, expect, it } from 'vitest';
import { normalizeManagerWorkerConfig, planManagerWorker } from '../../../src/core/agentRuntime/taskPlanner';

describe('taskPlanner', () => {
  it('does not run for non-eligible routes', () => {
    const config = normalizeManagerWorkerConfig({ enabled: true });
    const planning = planManagerWorker({
      config,
      routeKind: 'chat',
      searchMode: null,
      userText: 'hello',
    });

    expect(planning.eligibleRoute).toBe(false);
    expect(planning.shouldRun).toBe(false);
    expect(planning.plan).toBeNull();
  });

  it('runs for complex search route and emits three worker tasks by default', () => {
    const config = normalizeManagerWorkerConfig({
      enabled: true,
      maxWorkers: 3,
    });
    const planning = planManagerWorker({
      config,
      routeKind: 'search',
      searchMode: 'complex',
      userText: 'compare latest GPU prices and shipping from 5 stores with links',
    });

    expect(planning.shouldRun).toBe(true);
    expect(planning.plan?.routeKind).toBe('search');
    expect(planning.plan?.tasks.map((task) => task.worker)).toEqual([
      'research',
      'verification',
      'synthesis',
    ]);
  });

  it('respects worker budget and keeps synthesis in reduced plans', () => {
    const config = normalizeManagerWorkerConfig({
      enabled: true,
      maxWorkers: 2,
      minComplexityScore: 0.2,
    });
    const planning = planManagerWorker({
      config,
      routeKind: 'coding',
      searchMode: null,
      userText:
        'Debug this runtime error, compare two patch options, verify edge cases, and recommend final fix.',
    });

    expect(planning.shouldRun).toBe(true);
    expect(planning.plan?.tasks.map((task) => task.worker)).toEqual(['research', 'synthesis']);
  });

  it('skips simple coding prompts below complexity threshold', () => {
    const config = normalizeManagerWorkerConfig({
      enabled: true,
      minComplexityScore: 0.8,
    });
    const planning = planManagerWorker({
      config,
      routeKind: 'coding',
      searchMode: null,
      userText: 'write hello world',
    });

    expect(planning.shouldRun).toBe(false);
    expect(planning.plan).toBeNull();
  });
});
