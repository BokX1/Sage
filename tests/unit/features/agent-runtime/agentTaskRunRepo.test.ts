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

import {
  findRunningTaskRunForActiveInterrupt,
  findWaitingUserInputTaskRun,
  queueRunningTaskRunActiveInterrupt,
} from '@/features/agent-runtime/agentTaskRunRepo';

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
    completionKind: 'user_input_pending',
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
    activeUserInterruptJson: null,
    activeUserInterruptRevision: 0,
    activeUserInterruptConsumedRevision: 0,
    activeUserInterruptQueuedAt: null,
    activeUserInterruptConsumedAt: null,
    activeUserInterruptSupersededAt: null,
    activeUserInterruptSupersededRevision: null,
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

  it('refuses to auto-resume even when there is only one waiting candidate without a direct reply match', async () => {
    mockFindMany.mockResolvedValue([
      makeTaskRunRow({ id: 'run-only', threadId: 'thread-only', responseMessageId: 'response-only' }),
    ]);

    const result = await findWaitingUserInputTaskRun({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      replyToMessageId: null,
    });

    expect(result).toBeNull();
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

  it("does not resume a waiting run when the user replies to their own source message instead of Sage's waiting reply", async () => {
    mockFindMany.mockResolvedValue([
      makeTaskRunRow({
        id: 'run-source-only',
        threadId: 'thread-source-only',
        sourceMessageId: 'user-source-message',
        responseMessageId: 'sage-waiting-message',
      }),
    ]);

    const result = await findWaitingUserInputTaskRun({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      replyToMessageId: 'user-source-message',
    });

    expect(result).toBeNull();
  });

  it('matches a waiting run when the canonical Sage reply only exists inside persisted response-session state', async () => {
    mockFindMany.mockResolvedValue([
      makeTaskRunRow({
        id: 'run-session-only',
        threadId: 'thread-session-only',
        responseMessageId: null,
        responseSessionJson: {
          responseSessionId: 'thread-session-only',
          responseMessageId: 'sage-waiting-session-message',
          sourceMessageId: 'user-source-message',
        },
      }),
    ]);

    const result = await findWaitingUserInputTaskRun({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      replyToMessageId: 'sage-waiting-session-message',
    });

    expect(result?.threadId).toBe('thread-session-only');
  });
});

describe('AgentTaskRunRepo active-run steering interrupts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches only a running task reply to the canonical response message', async () => {
    mockFindMany.mockResolvedValue([
      makeTaskRunRow({
        id: 'run-running-1',
        threadId: 'thread-running-1',
        status: 'running',
        waitingKind: null,
        responseMessageId: 'canonical-response-1',
      }),
      makeTaskRunRow({
        id: 'run-running-2',
        threadId: 'thread-running-2',
        status: 'running',
        waitingKind: null,
        responseMessageId: 'other-response-2',
      }),
    ]);

    const result = await findRunningTaskRunForActiveInterrupt({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      replyToMessageId: 'canonical-response-1',
    });

    expect(result?.threadId).toBe('thread-running-1');
  });

  it('matches an exact running-task reply even when the canonical response is older than the newest five runs', async () => {
    mockFindMany.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) =>
        makeTaskRunRow({
          id: `run-running-cap-${index + 1}`,
          threadId: `thread-running-cap-${index + 1}`,
          status: 'running',
          waitingKind: null,
          responseMessageId: index === 5 ? 'canonical-response-old' : `other-response-${index + 1}`,
        }),
      ),
    );

    const result = await findRunningTaskRunForActiveInterrupt({
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      replyToMessageId: 'canonical-response-old',
    });

    expect(result?.threadId).toBe('thread-running-cap-6');
  });

  it('queues the latest active interrupt and records supersession metadata when replacing an unconsumed one', async () => {
    mockFindUnique.mockResolvedValue(
      makeTaskRunRow({
        id: 'run-running-3',
        threadId: 'thread-running-3',
        status: 'running',
        waitingKind: null,
        activeUserInterruptJson: {
          messageId: 'old-message',
          userId: 'user-1',
          channelId: 'channel-1',
          guildId: 'guild-1',
          userText: 'check repo A first',
        },
        activeUserInterruptRevision: 2,
        activeUserInterruptConsumedRevision: 1,
        activeUserInterruptQueuedAt: new Date('2026-03-20T10:00:00.000Z'),
      }),
    );
    mockUpdate.mockResolvedValue(
      makeTaskRunRow({
        id: 'run-running-3',
        threadId: 'thread-running-3',
        status: 'running',
        waitingKind: null,
        activeUserInterruptJson: {
          messageId: 'new-message',
          userId: 'user-1',
          channelId: 'channel-1',
          guildId: 'guild-1',
          userText: 'switch to repo B instead',
        },
        activeUserInterruptRevision: 3,
        activeUserInterruptConsumedRevision: 1,
        activeUserInterruptQueuedAt: new Date('2026-03-20T10:05:00.000Z'),
        activeUserInterruptSupersededAt: new Date('2026-03-20T10:05:00.000Z'),
        activeUserInterruptSupersededRevision: 2,
      }),
    );

    const result = await queueRunningTaskRunActiveInterrupt({
      threadId: 'thread-running-3',
      requestedByUserId: 'user-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      messageId: 'new-message',
      userText: 'switch to repo B instead',
      now: new Date('2026-03-20T10:05:00.000Z'),
    });

    expect(result).toBe('queued');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { threadId: 'thread-running-3' },
        data: expect.objectContaining({
          activeUserInterruptRevision: 3,
          activeUserInterruptConsumedAt: null,
          activeUserInterruptSupersededRevision: 2,
        }),
      }),
    );
  });

  it('returns stale when the task is already terminal before the interrupt can be queued', async () => {
    mockFindUnique.mockResolvedValue(
      makeTaskRunRow({
        id: 'run-terminal',
        threadId: 'thread-terminal',
        status: 'completed',
        waitingKind: null,
      }),
    );

    const result = await queueRunningTaskRunActiveInterrupt({
      threadId: 'thread-terminal',
      requestedByUserId: 'user-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      messageId: 'message-terminal',
      userText: 'one more thing',
    });

    expect(result).toBe('stale');
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
