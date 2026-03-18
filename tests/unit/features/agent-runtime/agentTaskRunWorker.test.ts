import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  claimRunnableAgentTaskRunMock,
  heartbeatAgentTaskRunMock,
  listRunnableAgentTaskRunsMock,
  releaseAgentTaskRunLeaseMock,
  resumeBackgroundTaskRunMock,
  attachTaskRunResponseSessionMock,
  clientMock,
} = vi.hoisted(() => ({
  claimRunnableAgentTaskRunMock: vi.fn(),
  heartbeatAgentTaskRunMock: vi.fn(),
  listRunnableAgentTaskRunsMock: vi.fn(),
  releaseAgentTaskRunLeaseMock: vi.fn(),
  resumeBackgroundTaskRunMock: vi.fn(),
  attachTaskRunResponseSessionMock: vi.fn(),
  clientMock: {
    isReady: vi.fn(() => true),
    channels: {
      fetch: vi.fn(async () => null),
    },
  },
}));

vi.mock('@/platform/config/env', () => ({
  config: {
    AGENT_RUN_WORKER_POLL_MS: 1_000,
  },
}));

vi.mock('@/platform/discord/client', () => ({
  client: clientMock,
}));

vi.mock('@/platform/logging/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/features/agent-runtime/langgraph/config', () => ({
  buildAgentGraphConfig: vi.fn(() => ({
    leaseTtlMs: 30_000,
    heartbeatMs: 5_000,
  })),
}));

vi.mock('@/features/agent-runtime/agentTaskRunRepo', () => ({
  claimRunnableAgentTaskRun: claimRunnableAgentTaskRunMock,
  heartbeatAgentTaskRun: heartbeatAgentTaskRunMock,
  listRunnableAgentTaskRuns: listRunnableAgentTaskRunsMock,
  releaseAgentTaskRunLease: releaseAgentTaskRunLeaseMock,
}));

vi.mock('@/features/agent-runtime/agentRuntime', () => ({
  resumeBackgroundTaskRun: resumeBackgroundTaskRunMock,
  attachTaskRunResponseSession: attachTaskRunResponseSessionMock,
}));

import {
  __resetAgentTaskRunWorkerForTests,
  initAgentTaskRunWorker,
  stopAgentTaskRunWorker,
} from '@/features/agent-runtime/agentTaskRunWorker';

describe('agentTaskRunWorker', () => {
  const originalVitestWorkerId = process.env.VITEST_WORKER_ID;

  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.VITEST_WORKER_ID;
    claimRunnableAgentTaskRunMock.mockReset();
    claimRunnableAgentTaskRunMock.mockResolvedValue(true);
    heartbeatAgentTaskRunMock.mockReset();
    heartbeatAgentTaskRunMock.mockResolvedValue(undefined);
    listRunnableAgentTaskRunsMock.mockReset();
    listRunnableAgentTaskRunsMock
      .mockResolvedValueOnce([
        {
          id: 'task-1',
          threadId: 'thread-1',
          guildId: 'guild-1',
          channelId: 'channel-1',
          requestedByUserId: 'user-1',
          sourceMessageId: 'message-1',
          responseMessageId: 'response-1',
          checkpointMetadataJson: { isAdmin: true, canModerate: false },
        },
      ])
      .mockResolvedValue([]);
    releaseAgentTaskRunLeaseMock.mockReset();
    releaseAgentTaskRunLeaseMock.mockResolvedValue(undefined);
    attachTaskRunResponseSessionMock.mockReset();
    attachTaskRunResponseSessionMock.mockResolvedValue(undefined);
    clientMock.isReady.mockReturnValue(true);
    clientMock.channels.fetch.mockResolvedValue(null);
  });

  afterEach(() => {
    stopAgentTaskRunWorker();
    __resetAgentTaskRunWorkerForTests();
    if (originalVitestWorkerId === undefined) {
      delete process.env.VITEST_WORKER_ID;
    } else {
      process.env.VITEST_WORKER_ID = originalVitestWorkerId;
    }
    vi.useRealTimers();
  });

  it('keeps heartbeating the claimed lease while a background resume is still running', async () => {
    let resolveResume: ((value: Record<string, unknown>) => void) | null = null;
    resumeBackgroundTaskRunMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResume = resolve;
        }),
    );

    initAgentTaskRunWorker();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(heartbeatAgentTaskRunMock).toHaveBeenCalledTimes(3);

    if (!resolveResume) {
      throw new Error('Expected background resume promise to be pending.');
    }
    const resolver = resolveResume as (value: Record<string, unknown>) => void;
    resolver({
      runId: 'thread-1',
      status: 'completed',
      replyText: 'done',
      delivery: 'response_session',
      files: [],
    });
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    const heartbeatCallsAfterResolve = heartbeatAgentTaskRunMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(heartbeatAgentTaskRunMock.mock.calls.length).toBe(heartbeatCallsAfterResolve);
    expect(releaseAgentTaskRunLeaseMock).toHaveBeenCalledWith({
      id: 'task-1',
      leaseOwner: expect.stringContaining('sage-task-worker:'),
    });
    expect(releaseAgentTaskRunLeaseMock).toHaveBeenCalledTimes(1);
  });

  it('reuses the first created response message for later updates in the same worker slice', async () => {
    listRunnableAgentTaskRunsMock.mockReset();
    listRunnableAgentTaskRunsMock
      .mockResolvedValueOnce([
        {
          id: 'task-1',
          threadId: 'thread-1',
          guildId: 'guild-1',
          channelId: 'channel-1',
          requestedByUserId: 'user-1',
          sourceMessageId: 'message-1',
          responseMessageId: null,
          checkpointMetadataJson: { isAdmin: true, canModerate: false },
        },
      ])
      .mockResolvedValue([]);
    const sourceMessage = {
      id: 'message-1',
      edit: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
    };
    const responseMessage = {
      id: 'response-1',
      edit: vi.fn().mockResolvedValue(undefined),
    };
    sourceMessage.reply.mockResolvedValue(responseMessage);

    clientMock.channels.fetch.mockImplementation(async () =>
      ({
        isTextBased: () => true,
        send: vi.fn().mockResolvedValue(responseMessage),
        messages: {
          fetch: vi.fn(async (messageId: string) => {
            if (messageId === 'message-1') {
              return sourceMessage;
            }
            if (messageId === 'response-1') {
              return responseMessage;
            }
            throw new Error(`Unexpected fetch: ${messageId}`);
          }),
        },
      }) as never,
    );

    resumeBackgroundTaskRunMock.mockImplementation(
      async (params: { onResponseSessionUpdate?: (update: Record<string, unknown>) => Promise<void> }) => {
        await params.onResponseSessionUpdate?.({
          replyText: 'First draft',
          delivery: 'response_session',
          responseSession: {
            responseSessionId: 'thread-1',
            status: 'draft',
            latestText: 'First draft',
            draftRevision: 1,
            sourceMessageId: 'message-1',
            responseMessageId: null,
            linkedArtifactMessageIds: [],
          },
          pendingInterrupt: null,
          completionKind: null,
          stopReason: 'background_yield',
        });
        await params.onResponseSessionUpdate?.({
          replyText: 'Second draft',
          delivery: 'response_session',
          responseSession: {
            responseSessionId: 'thread-1',
            status: 'draft',
            latestText: 'Second draft',
            draftRevision: 2,
            sourceMessageId: 'message-1',
            responseMessageId: 'response-1',
            linkedArtifactMessageIds: [],
          },
          pendingInterrupt: null,
          completionKind: null,
          stopReason: 'background_yield',
        });

        return {
          runId: 'thread-1',
          status: 'completed',
          replyText: 'Second draft',
          delivery: 'response_session',
          responseSession: {
            responseSessionId: 'thread-1',
            status: 'final',
            latestText: 'Second draft',
            draftRevision: 2,
            sourceMessageId: 'message-1',
            responseMessageId: 'response-1',
            linkedArtifactMessageIds: [],
          },
          files: [],
        };
      },
    );

    initAgentTaskRunWorker();
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    expect(sourceMessage.reply).toHaveBeenCalledTimes(1);
    expect(responseMessage.edit).toHaveBeenCalled();
    expect(attachTaskRunResponseSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        sourceMessageId: 'message-1',
        responseMessageId: 'response-1',
      }),
    );
  });

  it('reuses the persisted response-session json ids after restart when the top-level responseMessageId is missing', async () => {
    listRunnableAgentTaskRunsMock.mockReset();
    listRunnableAgentTaskRunsMock
      .mockResolvedValueOnce([
        {
          id: 'task-2',
          threadId: 'thread-2',
          guildId: 'guild-1',
          channelId: 'channel-1',
          requestedByUserId: 'user-1',
          sourceMessageId: 'message-2',
          responseMessageId: null,
          responseSessionJson: {
            responseSessionId: 'thread-2',
            status: 'draft',
            latestText: 'Existing draft',
            draftRevision: 1,
            sourceMessageId: 'message-2',
            responseMessageId: 'response-2',
            linkedArtifactMessageIds: [],
          },
          checkpointMetadataJson: { isAdmin: true, canModerate: false },
        },
      ])
      .mockResolvedValue([]);

    const sourceMessage = {
      id: 'message-2',
      edit: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
    };
    const responseMessage = {
      id: 'response-2',
      edit: vi.fn().mockResolvedValue(undefined),
    };
    sourceMessage.reply.mockResolvedValue(responseMessage);

    clientMock.channels.fetch.mockImplementation(async () =>
      ({
        isTextBased: () => true,
        send: vi.fn().mockResolvedValue(responseMessage),
        messages: {
          fetch: vi.fn(async (messageId: string) => {
            if (messageId === 'message-2') {
              return sourceMessage;
            }
            if (messageId === 'response-2') {
              return responseMessage;
            }
            throw new Error(`Unexpected fetch: ${messageId}`);
          }),
        },
      }) as never,
    );

    resumeBackgroundTaskRunMock.mockResolvedValue({
      runId: 'thread-2',
      status: 'completed',
      replyText: 'Updated after restart',
      delivery: 'response_session',
      responseSession: {
        responseSessionId: 'thread-2',
        status: 'final',
        latestText: 'Updated after restart',
        draftRevision: 2,
        sourceMessageId: 'message-2',
        responseMessageId: null,
        linkedArtifactMessageIds: [],
      },
      files: [],
    });

    initAgentTaskRunWorker();
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    expect(sourceMessage.reply).not.toHaveBeenCalled();
    expect(responseMessage.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Updated after restart',
      }),
    );
    expect(attachTaskRunResponseSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-2',
        responseMessageId: 'response-2',
      }),
    );
  });

  it('reconciles long overflow chunks across worker updates instead of re-sending duplicate tails', async () => {
    const longDraft = `${'A'.repeat(2_000)}${'B'.repeat(2_000)}${'C'.repeat(200)}`;
    listRunnableAgentTaskRunsMock.mockReset();
    listRunnableAgentTaskRunsMock
      .mockResolvedValueOnce([
        {
          id: 'task-3',
          threadId: 'thread-3',
          guildId: 'guild-1',
          channelId: 'channel-1',
          requestedByUserId: 'user-1',
          sourceMessageId: 'message-3',
          responseMessageId: 'response-3',
          checkpointMetadataJson: { isAdmin: true, canModerate: false },
        },
      ])
      .mockResolvedValue([]);

    const responseMessage = {
      id: 'response-3',
      content: '',
      edit: vi.fn().mockImplementation(async (payload: { content?: string }) => {
        responseMessage.content = payload.content ?? responseMessage.content;
        return responseMessage;
      }),
    };
    const overflowMessages = [
      {
        id: 'overflow-1',
        content: '',
        edit: vi.fn().mockImplementation(async (payload: { content?: string }) => {
          overflowMessages[0].content = payload.content ?? overflowMessages[0].content;
          return overflowMessages[0];
        }),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      {
        id: 'overflow-2',
        content: '',
        edit: vi.fn().mockImplementation(async (payload: { content?: string }) => {
          overflowMessages[1].content = payload.content ?? overflowMessages[1].content;
          return overflowMessages[1];
        }),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    ];
    const sendMock = vi
      .fn()
      .mockResolvedValueOnce(overflowMessages[0])
      .mockResolvedValueOnce(overflowMessages[1]);

    clientMock.channels.fetch.mockImplementation(async () =>
      ({
        isTextBased: () => true,
        send: sendMock,
        messages: {
          fetch: vi.fn(async (messageId: string) => {
            if (messageId === 'response-3') {
              return responseMessage;
            }
            if (messageId === 'overflow-1') {
              return overflowMessages[0];
            }
            if (messageId === 'overflow-2') {
              return overflowMessages[1];
            }
            throw new Error(`Unexpected fetch: ${messageId}`);
          }),
        },
      }) as never,
    );

    resumeBackgroundTaskRunMock.mockImplementation(
      async (params: { onResponseSessionUpdate?: (update: Record<string, unknown>) => Promise<void> }) => {
        await params.onResponseSessionUpdate?.({
          replyText: longDraft,
          delivery: 'response_session',
          responseSession: {
            responseSessionId: 'thread-3',
            status: 'draft',
            latestText: longDraft,
            draftRevision: 1,
            sourceMessageId: 'message-3',
            responseMessageId: 'response-3',
            linkedArtifactMessageIds: [],
          },
          pendingInterrupt: null,
          completionKind: null,
          stopReason: 'background_yield',
        });

        return {
          runId: 'thread-3',
          status: 'completed',
          replyText: longDraft,
          delivery: 'response_session',
          responseSession: {
            responseSessionId: 'thread-3',
            status: 'final',
            latestText: longDraft,
            draftRevision: 1,
            sourceMessageId: 'message-3',
            responseMessageId: 'response-3',
            linkedArtifactMessageIds: [],
          },
          files: [],
        };
      },
    );

    initAgentTaskRunWorker();
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(overflowMessages[0].edit).not.toHaveBeenCalled();
    expect(overflowMessages[1].edit).not.toHaveBeenCalled();
    expect(attachTaskRunResponseSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-3',
        responseSession: expect.objectContaining({
          overflowMessageIds: ['overflow-1', 'overflow-2'],
        }),
      }),
    );
  });
});
