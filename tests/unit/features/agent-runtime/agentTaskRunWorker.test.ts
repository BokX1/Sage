import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  claimRunnableAgentTaskRunMock,
  getAgentTaskRunByThreadIdMock,
  heartbeatAgentTaskRunMock,
  listRunnableAgentTaskRunsMock,
  releaseAgentTaskRunLeaseMock,
  resumeBackgroundTaskRunMock,
  runChatTurnMock,
  attachTaskRunResponseSessionMock,
  getUserProfileRecordMock,
  clientMock,
} = vi.hoisted(() => ({
  claimRunnableAgentTaskRunMock: vi.fn(),
  getAgentTaskRunByThreadIdMock: vi.fn(),
  heartbeatAgentTaskRunMock: vi.fn(),
  listRunnableAgentTaskRunsMock: vi.fn(),
  releaseAgentTaskRunLeaseMock: vi.fn(),
  resumeBackgroundTaskRunMock: vi.fn(),
  runChatTurnMock: vi.fn(),
  attachTaskRunResponseSessionMock: vi.fn(),
  getUserProfileRecordMock: vi.fn(),
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
  getAgentTaskRunByThreadId: getAgentTaskRunByThreadIdMock,
  heartbeatAgentTaskRun: heartbeatAgentTaskRunMock,
  listRunnableAgentTaskRuns: listRunnableAgentTaskRunsMock,
  releaseAgentTaskRunLease: releaseAgentTaskRunLeaseMock,
}));

vi.mock('@/features/agent-runtime/agentRuntime', () => ({
  resumeBackgroundTaskRun: resumeBackgroundTaskRunMock,
  runChatTurn: runChatTurnMock,
  attachTaskRunResponseSession: attachTaskRunResponseSessionMock,
}));

vi.mock('@/features/memory/userProfileRepo', () => ({
  getUserProfileRecord: getUserProfileRecordMock,
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
    getAgentTaskRunByThreadIdMock.mockReset();
    getAgentTaskRunByThreadIdMock.mockResolvedValue(null);
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
    runChatTurnMock.mockReset();
    runChatTurnMock.mockResolvedValue({
      runId: 'thread-1',
      status: 'completed',
      replyText: 'done',
      delivery: 'response_session',
      files: [],
    });
    attachTaskRunResponseSessionMock.mockReset();
    attachTaskRunResponseSessionMock.mockResolvedValue(undefined);
    getUserProfileRecordMock.mockReset();
    getUserProfileRecordMock.mockResolvedValue(null);
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
    getAgentTaskRunByThreadIdMock.mockResolvedValue({
      id: 'task-1',
      threadId: 'thread-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-1',
      responseMessageId: null,
      responseSessionJson: {
        responseSessionId: 'thread-1',
        status: 'draft',
        latestText: 'First draft',
        draftRevision: 1,
        sourceMessageId: 'message-1',
        responseMessageId: null,
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
      checkpointMetadataJson: { isAdmin: true, canModerate: false },
    });
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
    await vi.runOnlyPendingTimersAsync();
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

  it('boots scheduled agent-runs from the worker instead of resuming them as existing checkpoints', async () => {
    listRunnableAgentTaskRunsMock.mockReset();
    listRunnableAgentTaskRunsMock
      .mockResolvedValueOnce([
        {
          id: 'task-1',
          threadId: 'scheduled:task-1:run-1',
          guildId: 'guild-1',
          channelId: 'channel-1',
          requestedByUserId: 'user-1',
          sourceMessageId: 'scheduled:task-1:run-1',
          responseMessageId: null,
          responseSessionJson: {
            sourceMessageId: 'scheduled:task-1:run-1',
            responseMessageId: null,
            overflowMessageIds: [],
            surfaceAttached: false,
          },
          checkpointMetadataJson: {
            trigger: 'scheduled_agent_run',
            bootstrapPrompt: 'Check the moderation queue',
            bootstrapMentionedUserIds: ['user-2'],
            invokerAuthority: 'owner',
            isAdmin: true,
            canModerate: true,
          },
        },
      ])
      .mockResolvedValue([]);

    runChatTurnMock.mockResolvedValue({
      runId: 'scheduled:task-1:run-1',
      status: 'completed',
      replyText: 'Queued work finished.',
      delivery: 'response_session',
      files: [],
    });

    initAgentTaskRunWorker();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.runOnlyPendingTimersAsync();

    expect(runChatTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'scheduled:task-1:run-1',
        userId: 'user-1',
        userText: 'Check the moderation queue',
        mentionedUserIds: ['user-2'],
        invokerAuthority: 'owner',
        isAdmin: true,
        canModerate: true,
      }),
    );
    expect(resumeBackgroundTaskRunMock).not.toHaveBeenCalled();
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

  it('refreshes the latest persisted response-session id before falling back to a fresh reply', async () => {
    listRunnableAgentTaskRunsMock.mockReset();
    listRunnableAgentTaskRunsMock
      .mockResolvedValueOnce([
        {
          id: 'task-race',
          threadId: 'thread-race',
          guildId: 'guild-1',
          channelId: 'channel-1',
          requestedByUserId: 'user-1',
          sourceMessageId: 'message-race',
          responseMessageId: null,
          checkpointMetadataJson: { isAdmin: true, canModerate: false },
        },
      ])
      .mockResolvedValue([]);
    getAgentTaskRunByThreadIdMock.mockResolvedValue({
      id: 'task-race',
      threadId: 'thread-race',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-race',
      responseMessageId: 'response-race',
      responseSessionJson: {
        responseSessionId: 'thread-race',
        status: 'draft',
        latestText: 'Existing draft',
        draftRevision: 1,
        sourceMessageId: 'message-race',
        responseMessageId: 'response-race',
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
      checkpointMetadataJson: { isAdmin: true, canModerate: false },
    });

    const sourceMessage = {
      id: 'message-race',
      edit: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
    };
    const responseMessage = {
      id: 'response-race',
      edit: vi.fn().mockResolvedValue(undefined),
    };

    clientMock.channels.fetch.mockImplementation(async () =>
      ({
        isTextBased: () => true,
        send: vi.fn().mockResolvedValue(responseMessage),
        messages: {
          fetch: vi.fn(async (messageId: string) => {
            if (messageId === 'message-race') {
              return sourceMessage;
            }
            if (messageId === 'response-race') {
              return responseMessage;
            }
            throw new Error(`Unexpected fetch: ${messageId}`);
          }),
        },
      }) as never,
    );

    resumeBackgroundTaskRunMock.mockResolvedValue({
      runId: 'thread-race',
      status: 'completed',
      replyText: 'Updated after refresh',
      delivery: 'response_session',
      responseSession: {
        responseSessionId: 'thread-race',
        status: 'final',
        latestText: 'Updated after refresh',
        draftRevision: 2,
        sourceMessageId: 'message-race',
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
        content: 'Updated after refresh',
      }),
    );
    expect(attachTaskRunResponseSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-race',
        responseMessageId: 'response-race',
      }),
    );
  });

  it('falls back to the origin channel when the stored response thread is gone', async () => {
    listRunnableAgentTaskRunsMock.mockReset();
    listRunnableAgentTaskRunsMock
      .mockResolvedValueOnce([
        {
          id: 'task-thread-gone',
          threadId: 'thread-thread-gone',
          guildId: 'guild-1',
          originChannelId: 'channel-origin',
          responseChannelId: 'thread-missing',
          requestedByUserId: 'user-1',
          sourceMessageId: 'message-origin',
          responseMessageId: 'response-thread-gone',
          checkpointMetadataJson: { isAdmin: true, canModerate: false },
        },
      ])
      .mockResolvedValue([]);
    getAgentTaskRunByThreadIdMock.mockResolvedValue({
      id: 'task-thread-gone',
      threadId: 'thread-thread-gone',
      guildId: 'guild-1',
      originChannelId: 'channel-origin',
      responseChannelId: 'thread-missing',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-origin',
      responseMessageId: 'response-thread-gone',
      responseSessionJson: {
        responseSessionId: 'thread-thread-gone',
        status: 'draft',
        latestText: 'Existing thread response',
        draftRevision: 1,
        sourceMessageId: 'message-origin',
        responseMessageId: 'response-thread-gone',
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
      checkpointMetadataJson: { isAdmin: true, canModerate: false },
    });

    const sourceMessage = {
      id: 'message-origin',
      edit: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
    };
    const fallbackResponse = {
      id: 'response-origin-fallback',
      edit: vi.fn().mockResolvedValue(undefined),
    };
    sourceMessage.reply.mockResolvedValue(fallbackResponse);

    clientMock.channels.fetch.mockImplementation(async (...args: unknown[]) => {
      const channelId = args[0] as string;
      if (channelId === 'thread-missing') {
        return null;
      }
      if (channelId === 'channel-origin') {
        return {
          isTextBased: () => true,
          send: vi.fn().mockResolvedValue(fallbackResponse),
          messages: {
            fetch: vi.fn(async (messageId: string) => {
              if (messageId === 'message-origin') {
                return sourceMessage;
              }
              throw new Error(`Unexpected fetch: ${messageId}`);
            }),
          },
        } as never;
      }
      return null;
    });

    resumeBackgroundTaskRunMock.mockResolvedValue({
      runId: 'thread-thread-gone',
      status: 'completed',
      replyText: 'Recovered on the parent channel.',
      delivery: 'response_session',
      responseSession: {
        responseSessionId: 'thread-thread-gone',
        status: 'final',
        latestText: 'Recovered on the parent channel.',
        draftRevision: 2,
        sourceMessageId: 'message-origin',
        responseMessageId: null,
        linkedArtifactMessageIds: [],
      },
      files: [],
    });

    initAgentTaskRunWorker();
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    expect(sourceMessage.reply).toHaveBeenCalledTimes(1);
    expect(attachTaskRunResponseSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-thread-gone',
        originChannelId: 'channel-origin',
        responseChannelId: 'channel-origin',
        responseMessageId: 'response-origin-fallback',
      }),
    );
  });

  it('does not post a second reply when the canonical response message is bound but temporarily unfetchable', async () => {
    listRunnableAgentTaskRunsMock.mockReset();
    listRunnableAgentTaskRunsMock
      .mockResolvedValueOnce([
        {
          id: 'task-missing-response',
          threadId: 'thread-missing-response',
          guildId: 'guild-1',
          channelId: 'channel-1',
          requestedByUserId: 'user-1',
          sourceMessageId: 'message-missing-response',
          responseMessageId: 'response-missing-response',
          checkpointMetadataJson: { isAdmin: true, canModerate: false },
        },
      ])
      .mockResolvedValue([]);

    const sourceMessage = {
      id: 'message-missing-response',
      edit: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
    };

    clientMock.channels.fetch.mockImplementation(async () =>
      ({
        isTextBased: () => true,
        send: vi.fn(),
        messages: {
          fetch: vi.fn(async (messageId: string) => {
            if (messageId === 'message-missing-response') {
              return sourceMessage;
            }
            throw new Error(`Missing message: ${messageId}`);
          }),
        },
      }) as never,
    );

    resumeBackgroundTaskRunMock.mockResolvedValue({
      runId: 'thread-missing-response',
      status: 'completed',
      replyText: 'Should not create a duplicate reply',
      delivery: 'response_session',
      responseSession: {
        responseSessionId: 'thread-missing-response',
        status: 'final',
        latestText: 'Should not create a duplicate reply',
        draftRevision: 2,
        sourceMessageId: 'message-missing-response',
        responseMessageId: 'response-missing-response',
        linkedArtifactMessageIds: [],
      },
      files: [],
    });

    initAgentTaskRunWorker();
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    expect(sourceMessage.reply).not.toHaveBeenCalled();
    expect(attachTaskRunResponseSessionMock).not.toHaveBeenCalled();
  });

  it('does not fall back to a fresh reply when worker state refresh fails before publish', async () => {
    listRunnableAgentTaskRunsMock.mockReset();
    listRunnableAgentTaskRunsMock
      .mockResolvedValueOnce([
        {
          id: 'task-refresh-failed',
          threadId: 'thread-refresh-failed',
          guildId: 'guild-1',
          channelId: 'channel-1',
          requestedByUserId: 'user-1',
          sourceMessageId: 'message-refresh-failed',
          responseMessageId: null,
          checkpointMetadataJson: { isAdmin: true, canModerate: false },
        },
      ])
      .mockResolvedValue([]);
    getAgentTaskRunByThreadIdMock.mockRejectedValue(new Error('db unavailable'));

    const sourceMessage = {
      id: 'message-refresh-failed',
      edit: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
    };

    clientMock.channels.fetch.mockImplementation(async () =>
      ({
        isTextBased: () => true,
        send: vi.fn(),
        messages: {
          fetch: vi.fn(async (messageId: string) => {
            if (messageId === 'message-refresh-failed') {
              return sourceMessage;
            }
            throw new Error(`Missing message: ${messageId}`);
          }),
        },
      }) as never,
    );

    resumeBackgroundTaskRunMock.mockResolvedValue({
      runId: 'thread-refresh-failed',
      status: 'completed',
      replyText: 'Should not create a duplicate reply during refresh failure',
      delivery: 'response_session',
      responseSession: {
        responseSessionId: 'thread-refresh-failed',
        status: 'final',
        latestText: 'Should not create a duplicate reply during refresh failure',
        draftRevision: 2,
        sourceMessageId: 'message-refresh-failed',
        responseMessageId: null,
        linkedArtifactMessageIds: [],
      },
      files: [],
    });

    initAgentTaskRunWorker();
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    expect(sourceMessage.reply).not.toHaveBeenCalled();
    expect(attachTaskRunResponseSessionMock).not.toHaveBeenCalled();
  });

  it('does not fall back to a fresh reply when persisted response-session metadata says the canonical surface is already attached', async () => {
    listRunnableAgentTaskRunsMock.mockReset();
    listRunnableAgentTaskRunsMock
      .mockResolvedValueOnce([
        {
          id: 'task-missing-attachment',
          threadId: 'thread-missing-attachment',
          guildId: 'guild-1',
          channelId: 'channel-1',
          requestedByUserId: 'user-1',
          sourceMessageId: 'message-missing-attachment',
          responseMessageId: null,
          checkpointMetadataJson: { isAdmin: true, canModerate: false },
        },
      ])
      .mockResolvedValue([]);
    getAgentTaskRunByThreadIdMock.mockResolvedValue({
      id: 'task-missing-attachment',
      threadId: 'thread-missing-attachment',
      guildId: 'guild-1',
      channelId: 'channel-1',
      requestedByUserId: 'user-1',
      sourceMessageId: 'message-missing-attachment',
      responseMessageId: null,
      responseSessionJson: {
        responseSessionId: 'thread-missing-attachment',
        status: 'draft',
        latestText: 'Visible draft already sent',
        draftRevision: 1,
        sourceMessageId: 'message-missing-attachment',
        responseMessageId: null,
        surfaceAttached: true,
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
      checkpointMetadataJson: { isAdmin: true, canModerate: false },
    });

    const sourceMessage = {
      id: 'message-missing-attachment',
      edit: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
    };

    clientMock.channels.fetch.mockImplementation(async () =>
      ({
        isTextBased: () => true,
        send: vi.fn(),
        messages: {
          fetch: vi.fn(async (messageId: string) => {
            if (messageId === 'message-missing-attachment') {
              return sourceMessage;
            }
            throw new Error(`Missing message: ${messageId}`);
          }),
        },
      }) as never,
    );

    resumeBackgroundTaskRunMock.mockResolvedValue({
      runId: 'thread-missing-attachment',
      status: 'completed',
      replyText: 'Should not create a duplicate reply after a failed foreground attachment',
      delivery: 'response_session',
      responseSession: {
        responseSessionId: 'thread-missing-attachment',
        status: 'final',
        latestText: 'Should not create a duplicate reply after a failed foreground attachment',
        draftRevision: 2,
        sourceMessageId: 'message-missing-attachment',
        responseMessageId: null,
        linkedArtifactMessageIds: [],
      },
      files: [],
    });

    initAgentTaskRunWorker();
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    expect(sourceMessage.reply).not.toHaveBeenCalled();
    expect(attachTaskRunResponseSessionMock).not.toHaveBeenCalled();
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
      reply: vi.fn().mockImplementation(async (payload: { content?: string }) => {
        if (!overflowMessages[0].content) {
          overflowMessages[0].content = payload.content ?? overflowMessages[0].content;
          return overflowMessages[0];
        }
        overflowMessages[1].content = payload.content ?? overflowMessages[1].content;
        return overflowMessages[1];
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
        reply: vi.fn().mockImplementation(async (payload: { content?: string }) => {
          overflowMessages[1].content = payload.content ?? overflowMessages[1].content;
          return overflowMessages[1];
        }),
      },
      {
        id: 'overflow-2',
        content: '',
        edit: vi.fn().mockImplementation(async (payload: { content?: string }) => {
          overflowMessages[1].content = payload.content ?? overflowMessages[1].content;
          return overflowMessages[1];
        }),
        delete: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn(),
      },
    ];
    const sendMock = vi.fn();

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

    expect(sendMock).not.toHaveBeenCalled();
    expect(responseMessage.reply).toHaveBeenCalledTimes(1);
    expect(overflowMessages[0].reply).toHaveBeenCalledTimes(1);
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

  it('does not publish a terminal worker reply when a newer active interrupt keeps the task running', async () => {
    getAgentTaskRunByThreadIdMock
      .mockResolvedValueOnce({
        id: 'task-terminal-suppressed',
        threadId: 'thread-terminal-suppressed',
        guildId: 'guild-1',
        channelId: 'channel-1',
        requestedByUserId: 'user-1',
        sourceMessageId: 'message-terminal-suppressed',
        responseMessageId: 'response-terminal-suppressed',
        status: 'running',
        responseSessionJson: {
          responseSessionId: 'thread-terminal-suppressed',
          status: 'draft',
          latestText: 'Still working.',
          draftRevision: 2,
          sourceMessageId: 'message-terminal-suppressed',
          responseMessageId: 'response-terminal-suppressed',
          surfaceAttached: true,
          overflowMessageIds: [],
          linkedArtifactMessageIds: [],
        },
        checkpointMetadataJson: { isAdmin: true, canModerate: false },
      })
      .mockResolvedValueOnce({
        id: 'task-terminal-suppressed',
        threadId: 'thread-terminal-suppressed',
        guildId: 'guild-1',
        channelId: 'channel-1',
        requestedByUserId: 'user-1',
        sourceMessageId: 'message-terminal-suppressed',
        responseMessageId: 'response-terminal-suppressed',
        status: 'running',
        responseSessionJson: {
          responseSessionId: 'thread-terminal-suppressed',
          status: 'draft',
          latestText: 'Still working.',
          draftRevision: 2,
          sourceMessageId: 'message-terminal-suppressed',
          responseMessageId: 'response-terminal-suppressed',
          surfaceAttached: true,
          overflowMessageIds: [],
          linkedArtifactMessageIds: [],
        },
        checkpointMetadataJson: { isAdmin: true, canModerate: false },
      });

    const responseMessage = {
      id: 'response-terminal-suppressed',
      edit: vi.fn().mockResolvedValue(undefined),
    };

    clientMock.channels.fetch.mockImplementation(async () =>
      ({
        isTextBased: () => true,
        send: vi.fn(),
        messages: {
          fetch: vi.fn(async (messageId: string) => {
            if (messageId === 'response-terminal-suppressed') {
              return responseMessage;
            }
            throw new Error(`Unexpected fetch: ${messageId}`);
          }),
        },
      }) as never,
    );

    resumeBackgroundTaskRunMock.mockResolvedValue({
      runId: 'thread-terminal-suppressed',
      status: 'completed',
      replyText: 'Final answer that should be suppressed.',
      delivery: 'response_session',
      completionKind: 'final_answer',
      responseSession: {
        responseSessionId: 'thread-terminal-suppressed',
        status: 'final',
        latestText: 'Final answer that should be suppressed.',
        draftRevision: 3,
        sourceMessageId: 'message-terminal-suppressed',
        responseMessageId: 'response-terminal-suppressed',
        linkedArtifactMessageIds: [],
      },
      files: [],
    });

    initAgentTaskRunWorker();
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    expect(responseMessage.edit).not.toHaveBeenCalled();
    expect(attachTaskRunResponseSessionMock).not.toHaveBeenCalled();
  });
});
