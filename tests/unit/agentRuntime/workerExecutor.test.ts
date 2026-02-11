import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMClient } from '../../../src/core/llm/llm-types';
import { ManagerWorkerPlan } from '../../../src/core/agentRuntime/taskPlanner';

const mockResolveModelForRequestDetailed = vi.hoisted(() => vi.fn());
const mockRecordModelOutcome = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());

vi.mock('../../../src/core/llm/model-resolver', () => ({
  resolveModelForRequestDetailed: mockResolveModelForRequestDetailed,
}));
vi.mock('../../../src/core/llm/model-health', () => ({
  recordModelOutcome: mockRecordModelOutcome,
}));
vi.mock('../../../src/core/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
  },
}));

import { executeManagerWorkerPlan } from '../../../src/core/agentRuntime/workerExecutor';

describe('workerExecutor', () => {
  const plan: ManagerWorkerPlan = {
    routeKind: 'search',
    complexityScore: 0.9,
    rationale: ['search_complex_mode'],
    loops: 1,
    tasks: [
      {
        id: 'research-1',
        worker: 'research',
        objective: 'Collect findings',
      },
      {
        id: 'verification-1',
        worker: 'verification',
        objective: 'Verify findings',
      },
      {
        id: 'synthesis-1',
        worker: 'synthesis',
        objective: 'Synthesize findings',
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveModelForRequestDetailed.mockResolvedValue({
      model: 'gemini-search',
      route: 'search',
      requirements: {},
      allowlistApplied: false,
      candidates: ['gemini-search'],
      decisions: [{ model: 'gemini-search', accepted: true, reason: 'selected', healthScore: 0.8 }],
    });
  });

  it('executes worker tasks and preserves plan order in artifacts', async () => {
    const client: LLMClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            summary: 'research summary',
            keyPoints: ['k1'],
            openQuestions: [],
            citations: ['https://a.com'],
            confidence: 0.8,
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            summary: 'verification summary',
            keyPoints: ['k2'],
            openQuestions: ['q1'],
            citations: ['https://b.com'],
            confidence: 0.7,
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            summary: 'synthesis summary',
            keyPoints: ['k3'],
            openQuestions: [],
            citations: ['https://c.com'],
            confidence: 0.9,
          }),
        }),
    };

    const result = await executeManagerWorkerPlan({
      traceId: 'trace-1',
      guildId: 'guild-1',
      apiKey: 'test-key',
      userText: 'compare latest results',
      contextText: 'context',
      plan,
      client,
      maxParallel: 2,
      maxTokens: 500,
      maxInputChars: 18_000,
      timeoutMs: 5000,
    });

    expect(result.totalWorkers).toBe(3);
    expect(result.failedWorkers).toBe(0);
    expect(result.artifacts.map((artifact) => artifact.taskId)).toEqual([
      'research-1',
      'verification-1',
      'synthesis-1',
    ]);
    expect(result.artifacts[2]?.summary).toBe('synthesis summary');
    expect(mockRecordModelOutcome).toHaveBeenCalledTimes(3);
  });

  it('keeps non-fatal fallback when worker output is not parseable JSON', async () => {
    const client: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        content: 'This is plain text output',
      }),
    };
    const singleTaskPlan: ManagerWorkerPlan = {
      ...plan,
      tasks: [
        {
          id: 'synthesis-1',
          worker: 'synthesis',
          objective: 'Synthesize findings',
        },
      ],
    };

    const result = await executeManagerWorkerPlan({
      traceId: 'trace-2',
      guildId: 'guild-1',
      apiKey: 'test-key',
      userText: 'summarize this',
      contextText: 'context',
      plan: singleTaskPlan,
      client,
      maxParallel: 1,
      maxTokens: 500,
      maxInputChars: 18_000,
      timeoutMs: 5000,
    });

    expect(result.failedWorkers).toBe(0);
    expect(result.artifacts[0]?.openQuestions).toContain('worker_output_unstructured_repaired');
  });

  it('marks worker as failed when unstructured output is empty/unusable', async () => {
    const client: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        content: ' \n  \n ',
      }),
    };
    const singleTaskPlan: ManagerWorkerPlan = {
      ...plan,
      tasks: [
        {
          id: 'synthesis-1',
          worker: 'synthesis',
          objective: 'Synthesize findings',
        },
      ],
    };

    const result = await executeManagerWorkerPlan({
      traceId: 'trace-2b',
      guildId: 'guild-1',
      apiKey: 'test-key',
      userText: 'summarize this',
      contextText: 'context',
      plan: singleTaskPlan,
      client,
      maxParallel: 1,
      maxTokens: 500,
      maxInputChars: 18_000,
      timeoutMs: 5000,
    });

    expect(result.failedWorkers).toBe(1);
    expect(result.artifacts[0]?.failed).toBe(true);
    expect(result.artifacts[0]?.openQuestions).toContain('worker_output_unusable');
  });

  it('marks worker failure and continues when model call throws', async () => {
    const client: LLMClient = {
      chat: vi.fn().mockRejectedValue(new Error('provider down')),
    };
    const singleTaskPlan: ManagerWorkerPlan = {
      ...plan,
      tasks: [
        {
          id: 'research-1',
          worker: 'research',
          objective: 'Collect findings',
        },
      ],
    };

    const result = await executeManagerWorkerPlan({
      traceId: 'trace-3',
      guildId: 'guild-1',
      apiKey: 'test-key',
      userText: 'find sources',
      contextText: 'context',
      plan: singleTaskPlan,
      client,
      maxParallel: 1,
      maxTokens: 500,
      maxInputChars: 18_000,
      timeoutMs: 5000,
    });

    expect(result.failedWorkers).toBe(1);
    expect(result.artifacts[0]?.failed).toBe(true);
    expect(result.artifacts[0]?.model).toBe('gemini-search');
    expect(mockRecordModelOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-search',
        success: false,
      }),
    );
    expect(mockLoggerWarn).toHaveBeenCalled();
  });

  it('applies input budgeting and preserves prompt head/tail markers on truncation', async () => {
    const client: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          summary: 'ok',
          keyPoints: ['a'],
          openQuestions: [],
          citations: [],
          confidence: 0.8,
        }),
      }),
    };
    const result = await executeManagerWorkerPlan({
      traceId: 'trace-4',
      guildId: 'guild-1',
      apiKey: 'test-key',
      userText: `HEAD_${'A'.repeat(10_000)}_TAIL`,
      contextText: `CTX_${'B'.repeat(12_000)}_TAIL`,
      plan: {
        ...plan,
        tasks: [
          {
            id: 'research-1',
            worker: 'research',
            objective: 'Collect findings',
          },
        ],
      },
      client,
      maxParallel: 1,
      maxTokens: 500,
      maxInputChars: 4_500,
      timeoutMs: 5000,
    });

    expect(result.failedWorkers).toBe(0);
    const call = (client.chat as any).mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = call.messages.find((message) => message.role === 'user')?.content ?? '';
    expect(userMessage).toContain('chars omitted');
    expect(userMessage).toContain('HEAD_');
    expect(userMessage).toContain('_TAIL');
  });
});
