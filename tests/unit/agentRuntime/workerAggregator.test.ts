import { describe, expect, it } from 'vitest';
import { aggregateManagerWorkerArtifacts } from '../../../src/core/agentRuntime/workerAggregator';
import { ManagerWorkerArtifact } from '../../../src/core/agentRuntime/managerWorkerTypes';

function artifact(partial: Partial<ManagerWorkerArtifact>): ManagerWorkerArtifact {
  return {
    taskId: partial.taskId ?? 'task-1',
    worker: partial.worker ?? 'research',
    objective: partial.objective ?? 'obj',
    model: partial.model ?? 'openai-large',
    summary: partial.summary ?? 'summary',
    keyPoints: partial.keyPoints ?? [],
    openQuestions: partial.openQuestions ?? [],
    citations: partial.citations ?? [],
    confidence: partial.confidence ?? 0.8,
    latencyMs: partial.latencyMs ?? 10,
    failed: partial.failed ?? false,
    error: partial.error,
    rawText: partial.rawText ?? '',
  };
}

describe('workerAggregator', () => {
  it('aggregates successful artifacts into context block', () => {
    const result = aggregateManagerWorkerArtifacts({
      artifacts: [
        artifact({
          taskId: 'r1',
          worker: 'research',
          summary: 'Found candidate source A and B.',
          keyPoints: ['A supports claim 1', 'B disagrees with A'],
          citations: ['https://a.com', 'https://b.com'],
        }),
        artifact({
          taskId: 'v1',
          worker: 'verification',
          summary: 'Need to qualify claim 1 with version scope.',
          openQuestions: ['Which version window?'],
          citations: ['https://b.com', 'https://c.com'],
        }),
      ],
    });

    expect(result.contextBlock).toContain('## Manager-Worker Findings');
    expect(result.contextBlock).toContain('[research]');
    expect(result.contextBlock).toContain('[verification]');
    expect(result.citationCount).toBe(3);
    expect(result.successfulWorkers).toBe(2);
    expect(result.failedWorkers).toBe(0);
  });

  it('returns empty context when all workers failed', () => {
    const result = aggregateManagerWorkerArtifacts({
      artifacts: [
        artifact({ taskId: 'r1', worker: 'research', failed: true }),
        artifact({ taskId: 'v1', worker: 'verification', failed: true }),
      ],
    });

    expect(result.contextBlock).toBe('');
    expect(result.successfulWorkers).toBe(0);
    expect(result.failedWorkers).toBe(2);
  });
});
