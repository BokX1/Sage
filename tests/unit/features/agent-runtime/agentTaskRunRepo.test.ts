import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindMany, mockFindUnique, mockCreate, mockUpsert, mockUpdate, mockUpdateMany, mockDeleteMany } =
  vi.hoisted(() => ({
    mockFindMany: vi.fn(),
    mockFindUnique: vi.fn(),
    mockCreate: vi.fn(),
    mockUpsert: vi.fn(),
    mockUpdate: vi.fn(),
    mockUpdateMany: vi.fn(),
    mockDeleteMany: vi.fn(),
  }));

vi.mock('@/platform/db/prisma-client', () => ({
  prisma: {
    agentTaskRun: {
      create: mockCreate,
      findUnique: mockFindUnique,
      upsert: mockUpsert,
      update: mockUpdate,
      updateMany: mockUpdateMany,
      findMany: mockFindMany,
      deleteMany: mockDeleteMany,
    },
  },
}));

import { findWaitingUserInputTaskRun } from '@/features/agent-runtime/agentTaskRunRepo';

function makeTaskRunRow(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-03-17T12:00:00.000Z');
  return {
    id: 'run-1',
    threadId: 'thread-1',
    originTraceId: 'thread-1',
    latestTraceId: 'trace-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    requestedByUserId: 'user-1',
    sourceMessageId: 'source-1',
    responseMessageId: 'response-1',
    status: 'waiting_user_input',
    waitingKind: 'user_input',
    latestDraftText: 'Need one more detail.',
    draftRevision: 2,
    completionKind: 'clarification_question',
    stopReason: 'user_input_interrupt',
    nextRunnableAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    resumeCount: 0,
    taskWallClockMs: 0,
    maxTotalDurationMs: 3_600_000,
    maxIdleWaitMs: 86_400_000,
    lastErrorText: null,
    responseSessionJson: null,
    waitingStateJson: null,
    compactionStateJson: null,
    checkpointMetadataJson: null,
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('AgentTaskRunRepo.findWaitingUserInputTaskRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers a direct reply match when the user replies to the waiting draft', async () => {
    mockFindMany.mockResolvedValue([
      makeTaskRunRow({ id: 'run-older', threadId: 'thread-older', responseMessageId: 'response-older' }),
      makeTaskRunRow({ id: 'run-direct', threadId: 'thread-direct', responseMessageId: 'response-direct' }),
    ]);

    const result = await findWaitingUserInputTaskRun({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      replyToMessageId: 'response-direct',
    });

    expect(result?.threadId).toBe('thread-direct');
  });

  it('returns the only waiting run when there is a single unambiguous candidate', async () => {
    mockFindMany.mockResolvedValue([
      makeTaskRunRow({ id: 'run-only', threadId: 'thread-only', responseMessageId: 'response-only' }),
    ]);

    const result = await findWaitingUserInputTaskRun({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      replyToMessageId: null,
    });

    expect(result?.threadId).toBe('thread-only');
  });

  it('refuses to auto-resume when multiple waiting runs exist and the new message is not a direct reply', async () => {
    mockFindMany.mockResolvedValue([
      makeTaskRunRow({ id: 'run-a', threadId: 'thread-a', responseMessageId: 'response-a' }),
      makeTaskRunRow({ id: 'run-b', threadId: 'thread-b', responseMessageId: 'response-b' }),
    ]);

    const result = await findWaitingUserInputTaskRun({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      replyToMessageId: null,
    });

    expect(result).toBeNull();
  });
});
