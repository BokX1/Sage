import { Collection, type Message, type TextChannel, type User } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const {
  mockGenerateChatReply,
  mockClient,
  mockFetchAttachmentText,
  mockAttachTaskRunResponseSession,
  mockContinueMatchedTaskRunWithInput,
  mockGetAgentTaskRunByThreadId,
  mockQueueActiveRunUserInterrupt,
  mockResumeWaitingTaskRunWithInput,
  mockFindRunningTaskRunForActiveInterrupt,
  mockFindWaitingUserInputTaskRun,
} = vi.hoisted(() => {
  const mockGenerateChatReply = vi.fn();
  const mockClient = {
    user: { id: '123', tag: 'SageBot#0001' },
  };
  const mockFetchAttachmentText = vi.fn();
  const mockAttachTaskRunResponseSession = vi.fn().mockResolvedValue(undefined);
  const mockContinueMatchedTaskRunWithInput = vi.fn();
  const mockGetAgentTaskRunByThreadId = vi.fn().mockResolvedValue(null);
  const mockQueueActiveRunUserInterrupt = vi.fn().mockResolvedValue('queued');
  const mockResumeWaitingTaskRunWithInput = vi.fn();
  const mockFindRunningTaskRunForActiveInterrupt = vi.fn().mockResolvedValue(null);
  const mockFindWaitingUserInputTaskRun = vi.fn().mockResolvedValue(null);
  return {
    mockGenerateChatReply,
    mockClient,
    mockFetchAttachmentText,
    mockAttachTaskRunResponseSession,
    mockContinueMatchedTaskRunWithInput,
    mockGetAgentTaskRunByThreadId,
    mockQueueActiveRunUserInterrupt,
    mockResumeWaitingTaskRunWithInput,
    mockFindRunningTaskRunForActiveInterrupt,
    mockFindWaitingUserInputTaskRun,
  };
});

const mockIsRateLimited = vi.hoisted(() => vi.fn(() => false));
const mockIsLoggingEnabled = vi.hoisted(() => vi.fn(() => true));
const mockGenerateTraceId = vi.hoisted(() => vi.fn(() => 'test-trace-id'));
const mockIngestEvent = vi.hoisted(() => vi.fn());
const mockUpsertIngestedAttachment = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: 'attachment-row-default' }),
);
const mockDeleteAttachmentChunks = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockIngestAttachmentText = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockQueueImageAttachmentRecall = vi.hoisted(() => vi.fn());
const mockCreateInteractiveButtonSession = vi.hoisted(() => vi.fn(async () => 'sage:ui:continue-1'));
const mockBuildGuildApiKeyMissingResponse = vi.hoisted(() =>
  vi.fn(() => ({
    flags: 32768,
    components: [],
  })),
);

vi.mock('@/features/chat/chat-engine', () => ({
  generateChatReply: mockGenerateChatReply,
}));

vi.mock('@/features/agent-runtime', () => ({
  attachTaskRunResponseSession: mockAttachTaskRunResponseSession,
  continueMatchedTaskRunWithInput: mockContinueMatchedTaskRunWithInput,
  queueActiveRunUserInterrupt: mockQueueActiveRunUserInterrupt,
  resumeWaitingTaskRunWithInput: mockResumeWaitingTaskRunWithInput,
}));

vi.mock('@/features/agent-runtime/agentTaskRunRepo', () => ({
  findRunningTaskRunForActiveInterrupt: mockFindRunningTaskRunForActiveInterrupt,
  findWaitingUserInputTaskRun: mockFindWaitingUserInputTaskRun,
  getAgentTaskRunByThreadId: mockGetAgentTaskRunByThreadId,
}));

vi.mock('@/platform/files/file-handler', () => ({
  fetchAttachmentText: mockFetchAttachmentText,
}));

vi.mock('@/features/chat/rate-limiter', () => ({
  isRateLimited: mockIsRateLimited,
}));

vi.mock('@/features/settings/guildChannelSettings', () => ({
  isLoggingEnabled: mockIsLoggingEnabled,
}));

vi.mock('@/shared/observability/trace-id-generator', () => ({
  generateTraceId: mockGenerateTraceId,
}));

vi.mock('@/features/ingest/ingestEvent', () => ({
  ingestEvent: mockIngestEvent,
}));

vi.mock('@/features/attachments/ingestedAttachmentRepo', () => ({
  upsertIngestedAttachment: mockUpsertIngestedAttachment,
}));

vi.mock('@/features/embeddings', () => ({
  deleteAttachmentChunks: mockDeleteAttachmentChunks,
  ingestAttachmentText: mockIngestAttachmentText,
}));

vi.mock('@/features/attachments/imageAttachmentRecallWorker', () => ({
  queueImageAttachmentRecall: mockQueueImageAttachmentRecall,
}));

vi.mock('@/platform/discord/client', () => ({
  client: mockClient,
}));

vi.mock('@/features/discord/interactiveComponentService', () => ({
  buildActionButtonComponent: vi.fn((params: { customId: string; label: string; style?: string }) => ({
    type: 2,
    custom_id: params.customId,
    label: params.label,
    style: params.style === 'primary' ? 1 : 2,
  })),
  createInteractiveButtonSession: mockCreateInteractiveButtonSession,
  interactiveButtonActionSchema: z.any(),
}));

vi.mock('@/features/discord/byopBootstrap', () => ({
  buildGuildApiKeyMissingResponse: mockBuildGuildApiKeyMissingResponse,
}));

import { config } from '@/platform/config/env';
import {
  __resetMessageCreateHandlerStateForTests,
  handleMessageCreate,
} from '@/app/discord/handlers/messageCreate';
import { resetInvocationCooldowns } from '@/features/invocation/invocation-rate-limiter';

let messageCounter = 0;
const defaultMaxAttachmentsPerMessage = config.FILE_INGEST_MAX_ATTACHMENTS_PER_MESSAGE;

function createMockMessage(overrides: Record<string, unknown> = {}): Message {
  messageCounter += 1;

  const author = {
    id: 'user-456',
    bot: false,
    username: 'TestUser',
  } as unknown as User;

  const messageStore = new Map<string, {
    id: string;
    content: string;
    edit: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
  }>();
  let childCounter = 0;
  const createEditableMessage = (id: string) => {
    const editableMessage = {
      id,
      content: '',
      edit: vi.fn().mockImplementation(async (payload: { content?: string }) => {
        if (typeof payload?.content === 'string') {
          editableMessage.content = payload.content;
        }
        return editableMessage;
      }),
      delete: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockImplementation(async (payload: { content?: string }) => {
        childCounter += 1;
        const child = createEditableMessage(`${id}-child-${childCounter}`);
        if (typeof payload?.content === 'string') {
          child.content = payload.content;
        }
        return child;
      }),
    };
    messageStore.set(id, editableMessage);
    return editableMessage;
  };
  const responseMessage = createEditableMessage(`reply-${messageCounter}`);
  const sourceMessage = {
    id: `source-${messageCounter}`,
    content: '',
    reply: vi.fn().mockImplementation(async (payload: { content?: string }) => {
      if (typeof payload?.content === 'string') {
        responseMessage.content = payload.content;
      }
      return responseMessage;
    }),
  };

  const channel = {
    send: vi.fn().mockImplementation(async (payload: { content?: string }) => {
      childCounter += 1;
      const sentMessage = createEditableMessage(`send-${messageCounter}-${childCounter}`);
      if (typeof payload?.content === 'string') {
        sentMessage.content = payload.content;
      }
      return sentMessage;
    }),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    messages: {
      fetch: vi.fn(async (messageId: string) => {
        if (messageId === sourceMessage.id) {
          return sourceMessage;
        }
        const storedMessage = messageStore.get(messageId);
        if (storedMessage) {
          return storedMessage;
        }
        throw new Error(`Unknown message id: ${messageId}`);
      }),
    },
  } as unknown as TextChannel;

  const baseMock: Record<string, unknown> = {
    id: `msg-${messageCounter}`,
    content: 'Hello bot!',
    author,
    member: {
      displayName: 'TestUser',
    },
    guildId: 'guild-789',
    channelId: 'channel-101',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    mentions: {
      has: vi.fn(() => false),
      users: new Map<string, User>(),
    },
    reference: null,
    fetchReference: vi.fn(),
    attachments: {
      first: vi.fn(() => null),
      values: vi.fn(() => []),
    },
    channel,
    reply: vi.fn().mockResolvedValue(responseMessage),
    __responseMessage: responseMessage,
    __sourceMessage: sourceMessage,
    ...overrides,
  };

  return baseMock as unknown as Message;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('messageCreate - ingest + reply gating', () => {
  beforeEach(() => {
    __resetMessageCreateHandlerStateForTests();
    mockGenerateChatReply.mockReset();
    mockFetchAttachmentText.mockReset();
    mockAttachTaskRunResponseSession.mockReset();
    mockContinueMatchedTaskRunWithInput.mockReset();
    mockGetAgentTaskRunByThreadId.mockReset();
    mockQueueActiveRunUserInterrupt.mockReset();
    mockResumeWaitingTaskRunWithInput.mockReset();
    mockFindRunningTaskRunForActiveInterrupt.mockReset();
    mockFindWaitingUserInputTaskRun.mockReset();
    mockIsRateLimited.mockReset();
    mockIsLoggingEnabled.mockReset();
    mockIngestEvent.mockReset();
    mockUpsertIngestedAttachment.mockReset();
    mockDeleteAttachmentChunks.mockReset();
    mockIngestAttachmentText.mockReset();
    mockGenerateChatReply.mockResolvedValue({ replyText: 'Test response', delivery: 'response_session' });
    mockContinueMatchedTaskRunWithInput.mockResolvedValue({
      replyText: 'Continued response',
      delivery: 'response_session',
      status: 'completed',
      responseSession: {
        responseSessionId: 'thread-continued-default',
        status: 'final',
        latestText: 'Continued response',
        draftRevision: 1,
        sourceMessageId: 'source-continued-default',
        responseMessageId: 'reply-continued-default',
        surfaceAttached: true,
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
    });
    mockFetchAttachmentText.mockResolvedValue({
      kind: 'ok',
      text: 'default file text',
      extractor: 'tika',
      byteLength: 16,
      mimeType: 'text/plain',
    });
    mockIsRateLimited.mockReturnValue(false);
    mockAttachTaskRunResponseSession.mockResolvedValue(undefined);
    mockQueueActiveRunUserInterrupt.mockResolvedValue('queued');
    mockGetAgentTaskRunByThreadId.mockResolvedValue(null);
    mockResumeWaitingTaskRunWithInput.mockResolvedValue({
      replyText: 'Resumed waiting task',
      delivery: 'response_session',
      status: 'completed',
    });
    mockFindRunningTaskRunForActiveInterrupt.mockResolvedValue(null);
    mockFindWaitingUserInputTaskRun.mockResolvedValue(null);
    mockIsLoggingEnabled.mockReturnValue(true);
    mockDeleteAttachmentChunks.mockResolvedValue(undefined);
    mockIngestAttachmentText.mockResolvedValue(undefined);
    mockUpsertIngestedAttachment.mockResolvedValue({ id: 'attachment-row-default' });
    mockQueueImageAttachmentRecall.mockReset();
    mockCreateInteractiveButtonSession.mockReset();
    mockBuildGuildApiKeyMissingResponse.mockReset();
    mockBuildGuildApiKeyMissingResponse.mockReturnValue({
      flags: 32768,
      components: [],
    });
    config.FILE_INGEST_MAX_ATTACHMENTS_PER_MESSAGE = defaultMaxAttachmentsPerMessage;
    messageCounter = 0;
    resetInvocationCooldowns();
    mockCreateInteractiveButtonSession.mockResolvedValue('sage:ui:continue-1');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call generateChatReply for non-mention messages', async () => {
    const message = createMockMessage({
      content: 'Regular message without mention',
    });

    await handleMessageCreate(message);

    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: message.id }),
    );
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
    expect((message as unknown as { reply: ReturnType<typeof vi.fn> }).reply).not.toHaveBeenCalled();
  });

  it('calls generateChatReply for wakeword requests and replies', async () => {
    const message = createMockMessage({
      content: 'sage summarize what they are talking about',
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: 'summarize what they are talking about',
      }),
    );
    expect((message as unknown as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalled();
  });

  it('calls generateChatReply for bare wakeword invocations', async () => {
    const message = createMockMessage({
      content: 'sage',
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        invokedBy: 'wakeword',
        promptMode: 'direct_attention',
        userText:
          'The user explicitly invoked Sage without a concrete task yet. Briefly acknowledge them and ask what they need help with.',
      }),
    );
  });

  it('still delivers generated files when approval review is queued, without placeholder text', async () => {
    const attachment = Buffer.from('generated file');
    mockGenerateChatReply.mockResolvedValueOnce({
      replyText: '',
      delivery: 'approval_handoff',
      meta: {
        approvalReview: {
          requestId: 'approval-1',
          sourceChannelId: 'channel-101',
          reviewChannelId: 'review-1',
        },
      },
      files: [{ attachment, name: 'report.txt' }],
    });

    const message = createMockMessage({
      content: 'sage prepare the report and then update the Sage Persona',
    });

    await handleMessageCreate(message);

    expect((message as unknown as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedMentions: { repliedUser: false },
        files: [{ attachment, name: 'report.txt' }],
      }),
    );
    expect(
      (message as unknown as { reply: ReturnType<typeof vi.fn> }).reply.mock.calls[0]?.[0]?.content || undefined,
    ).toBeUndefined();
  });

  it('does not send a duplicate chat reply when approval review is queued without files', async () => {
    mockGenerateChatReply.mockResolvedValueOnce({
      replyText: '',
      delivery: 'approval_handoff',
      meta: {
        approvalReview: {
          requestId: 'approval-2',
          sourceChannelId: 'channel-101',
          reviewChannelId: 'review-1',
        },
      },
      files: [],
    });

    const message = createMockMessage({
      content: 'sage delete that helper message',
    });

    await handleMessageCreate(message);

    expect((message as unknown as { reply: ReturnType<typeof vi.fn> }).reply).not.toHaveBeenCalled();
  });

  it('keeps self-hosted missing-key replies in plain text instead of the hosted Pollinations bootstrap card', async () => {
    mockGenerateChatReply.mockResolvedValueOnce({
      replyText:
        "I'm not set up to chat in this server yet, so please ask the bot operator to add the AI provider key.",
      delivery: 'response_session',
      meta: {
        kind: 'missing_api_key',
        missingApiKey: {
          recovery: 'host_api_key',
        },
      },
      files: [],
    });

    const message = createMockMessage({
      content: 'sage hello',
    });

    await handleMessageCreate(message);

    expect(mockBuildGuildApiKeyMissingResponse).not.toHaveBeenCalled();
    expect((message as unknown as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("I'm not set up to chat in this server yet"),
      }),
    );
  });

  it('does not attach a legacy Continue button for normal response-session replies', async () => {
    mockGenerateChatReply.mockResolvedValueOnce({
      replyText: 'I checked the first batch and I am still working in the background.',
      delivery: 'response_session',
      meta: undefined,
      files: [],
    });

    const message = createMockMessage({
      content: 'sage keep going',
    });

    await handleMessageCreate(message);

    expect(mockCreateInteractiveButtonSession).not.toHaveBeenCalled();
    expect((message as unknown as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'I checked the first batch and I am still working in the background.',
        allowedMentions: { repliedUser: false },
      }),
    );
  });

  it('starts a fresh visible reply on the current follow-up when resuming a waiting run', async () => {
    const message = createMockMessage({
      content: 'sage here is the answer',
    }) as unknown as Message & {
      __responseMessage: { id: string; edit: ReturnType<typeof vi.fn> };
      __sourceMessage: { id: string };
      reply: ReturnType<typeof vi.fn>;
    };
    mockFindWaitingUserInputTaskRun.mockResolvedValueOnce({
      id: 'run-1',
      threadId: 'thread-existing',
      sourceMessageId: message.__sourceMessage.id,
      responseMessageId: message.__responseMessage.id,
    });
    mockResumeWaitingTaskRunWithInput.mockImplementationOnce(async (params) => {
      await params.onResponseSessionUpdate?.({
        replyText: 'Updated draft',
        delivery: 'response_session',
        responseSession: {
          responseSessionId: 'thread-existing',
          status: 'draft',
          latestText: 'Updated draft',
          draftRevision: 2,
          sourceMessageId: message.__sourceMessage.id,
          responseMessageId: message.__responseMessage.id,
          linkedArtifactMessageIds: [],
        },
        pendingInterrupt: null,
        completionKind: null,
        stopReason: 'background_yield',
      });

      return {
        runId: 'thread-existing',
        status: 'completed',
        replyText: 'Updated draft',
        delivery: 'response_session',
        responseSession: {
          responseSessionId: 'thread-existing',
          status: 'final',
          latestText: 'Updated draft',
          draftRevision: 2,
          sourceMessageId: message.__sourceMessage.id,
          responseMessageId: message.__responseMessage.id,
          linkedArtifactMessageIds: [],
        },
        files: [],
      };
    });

    await handleMessageCreate(message);

    expect(message.reply).toHaveBeenCalled();
    expect(message.__responseMessage.edit).not.toHaveBeenCalled();
    expect(mockAttachTaskRunResponseSession).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-existing',
        sourceMessageId: message.id,
        responseMessageId: message.__responseMessage.id,
        responseSession: expect.objectContaining({
          sourceMessageId: message.id,
          overflowMessageIds: [],
        }),
      }),
    );
  });

  it('queues a requester reply to a running Sage response as an active interrupt instead of starting a new turn', async () => {
    const referencedMessage = {
      id: 'running-response-1',
      author: {
        id: '123',
        bot: true,
        username: 'SageBot',
      } as User,
      member: null,
      guildId: 'guild-789',
      channelId: 'channel-101',
      reference: null,
      mentions: {
        users: new Collection<string, User>(),
      } as Message['mentions'],
      content: 'Still working on that.',
    } as Partial<Message>;
    const message = createMockMessage({
      content: 'sage switch to the second repo instead',
      reference: { messageId: 'running-response-1' },
      fetchReference: vi.fn().mockResolvedValue(referencedMessage),
    });
    mockFindRunningTaskRunForActiveInterrupt.mockResolvedValueOnce({
      id: 'run-running-1',
      threadId: 'thread-running-1',
      sourceMessageId: 'source-1',
      responseMessageId: 'running-response-1',
      status: 'running',
    });

    await handleMessageCreate(message);

    expect(mockQueueActiveRunUserInterrupt).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-running-1',
        userId: 'user-456',
        messageId: message.id,
        userText: 'switch to the second repo instead',
      }),
    );
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
    expect(mockResumeWaitingTaskRunWithInput).not.toHaveBeenCalled();
    expect((message as unknown as { reply: ReturnType<typeof vi.fn> }).reply).not.toHaveBeenCalled();
  });

  it('passes requester identity when attaching a fresh foreground response session so live steering can route before final persistence', async () => {
    mockGenerateChatReply.mockImplementationOnce(async (params: {
      messageId: string;
      onResponseSessionUpdate?: (update: {
        replyText: string;
        delivery: 'response_session';
        responseSession: {
          responseSessionId: string;
          status: 'draft';
          latestText: string;
          draftRevision: number;
          sourceMessageId: string;
          responseMessageId: string | null;
          surfaceAttached: boolean;
          overflowMessageIds: string[];
          linkedArtifactMessageIds: string[];
        };
        pendingInterrupt: null;
        completionKind: null;
        stopReason: 'background_yield';
      }) => Promise<void>;
    }) => {
      await params.onResponseSessionUpdate?.({
        replyText: 'Still working through the tool chain now.',
        delivery: 'response_session',
        responseSession: {
          responseSessionId: 'test-trace-id',
          status: 'draft',
          latestText: 'Still working through the tool chain now.',
          draftRevision: 1,
          sourceMessageId: params.messageId,
          responseMessageId: null,
          surfaceAttached: false,
          overflowMessageIds: [],
          linkedArtifactMessageIds: [],
        },
        pendingInterrupt: null,
        completionKind: null,
        stopReason: 'background_yield',
      });

      return {
        runId: 'test-trace-id',
        status: 'running',
        replyText: 'Still working through the tool chain now.',
        delivery: 'response_session',
        responseSession: {
          responseSessionId: 'test-trace-id',
          status: 'draft',
          latestText: 'Still working through the tool chain now.',
          draftRevision: 1,
          sourceMessageId: params.messageId,
          responseMessageId: null,
          surfaceAttached: false,
          overflowMessageIds: [],
          linkedArtifactMessageIds: [],
        },
        files: [],
      };
    });

    const message = createMockMessage({
      content: '<@123> keep going',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
    });

    await handleMessageCreate(message);

    expect(mockAttachTaskRunResponseSession).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'test-trace-id',
        requestedByUserId: 'user-456',
        channelId: 'channel-101',
        guildId: 'guild-789',
      }),
    );
  });

  it('fails closed instead of starting a fresh turn when a matched running-task interrupt cannot be queued', async () => {
    const referencedMessage = {
      id: 'running-response-queue-failure',
      author: {
        id: '123',
        bot: true,
        username: 'SageBot',
      } as User,
      member: null,
      guildId: 'guild-789',
      channelId: 'channel-101',
      reference: null,
      mentions: {
        users: new Collection<string, User>(),
      } as Message['mentions'],
      content: 'Still working on that.',
    } as Partial<Message>;
    const message = createMockMessage({
      content: 'sage switch the target to the docs repo',
      reference: { messageId: 'running-response-queue-failure' },
      fetchReference: vi.fn().mockResolvedValue(referencedMessage),
    });
    mockFindRunningTaskRunForActiveInterrupt.mockResolvedValueOnce({
      id: 'run-running-queue-failure',
      threadId: 'thread-running-queue-failure',
      sourceMessageId: 'source-1',
      responseMessageId: 'running-response-queue-failure',
      status: 'running',
    });
    mockQueueActiveRunUserInterrupt.mockResolvedValueOnce('rejected');

    await handleMessageCreate(message);

    expect(mockQueueActiveRunUserInterrupt).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-running-queue-failure',
        userId: 'user-456',
        messageId: message.id,
      }),
    );
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
    expect(mockResumeWaitingTaskRunWithInput).not.toHaveBeenCalled();
    expect((message as unknown as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalledTimes(1);
  });

  it('continues the matched task on the same response-session surface when the active-run interrupt races a terminal completion', async () => {
    const message = createMockMessage({
      content: 'sage switch the search to the docs repo',
      reference: { messageId: 'running-response-terminal-race' },
      fetchReference: vi.fn().mockResolvedValue(null),
    }) as Message & {
      __responseMessage: { id: string; edit: ReturnType<typeof vi.fn> };
      __sourceMessage: { id: string; reply: ReturnType<typeof vi.fn> };
      channel: {
        messages: { fetch: ReturnType<typeof vi.fn> };
      };
      reply: ReturnType<typeof vi.fn>;
    };
    const referencedMessage = {
      id: 'running-response-terminal-race',
      content: 'Still working on that.',
      edit: vi.fn().mockImplementation(async (payload: { content?: string }) => {
        if (typeof payload?.content === 'string') {
          referencedMessage.content = payload.content;
        }
        return referencedMessage;
      }),
      delete: vi.fn().mockResolvedValue(undefined),
      author: {
        id: '123',
        bot: true,
        username: 'SageBot',
      } as User,
      member: null,
      guildId: 'guild-789',
      channelId: 'channel-101',
      reference: null,
      mentions: {
        users: new Collection<string, User>(),
      } as Message['mentions'],
    } as Partial<Message> & {
      id: string;
      content: string;
      edit: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    message.channel.messages.fetch.mockImplementation(async (messageId: string) => {
      if (messageId === referencedMessage.id) {
        return referencedMessage;
      }
      if (messageId === message.__responseMessage.id) {
        return message.__responseMessage;
      }
      if (messageId === message.__sourceMessage.id) {
        return message.__sourceMessage;
      }
      throw new Error(`Unknown message id: ${messageId}`);
    });
    mockFindRunningTaskRunForActiveInterrupt.mockResolvedValueOnce({
      id: 'run-running-terminal-race',
      threadId: 'thread-running-terminal-race',
      sourceMessageId: 'source-1',
      responseMessageId: 'running-response-terminal-race',
      status: 'running',
    });
    mockGetAgentTaskRunByThreadId.mockResolvedValueOnce({
      id: 'run-running-terminal-race',
      threadId: 'thread-running-terminal-race',
      sourceMessageId: 'source-1',
      responseMessageId: 'running-response-terminal-race',
      status: 'completed',
      completionKind: 'final_answer',
      responseSessionJson: {
        responseSessionId: 'thread-running-terminal-race',
        status: 'final',
        latestText: 'Still working on that.',
        draftRevision: 4,
        sourceMessageId: 'source-1',
        responseMessageId: 'running-response-terminal-race',
        surfaceAttached: true,
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
    });
    mockQueueActiveRunUserInterrupt.mockResolvedValueOnce('stale');
    mockContinueMatchedTaskRunWithInput.mockImplementationOnce(async (params) => {
      await params.onResponseSessionUpdate?.({
        replyText: 'Switching to the docs repo on this same task.',
        delivery: 'response_session',
        responseSession: {
          responseSessionId: 'thread-running-terminal-race',
          status: 'draft',
          latestText: 'Switching to the docs repo on this same task.',
          draftRevision: 5,
          sourceMessageId: 'source-1',
          responseMessageId: 'running-response-terminal-race',
          surfaceAttached: true,
          overflowMessageIds: [],
          linkedArtifactMessageIds: [],
        },
        pendingInterrupt: null,
        completionKind: null,
        stopReason: 'background_yield',
      });

      return {
        runId: 'thread-running-terminal-race',
        status: 'running',
        replyText: 'Switching to the docs repo on this same task.',
        delivery: 'response_session',
        responseSession: {
          responseSessionId: 'thread-running-terminal-race',
          status: 'final',
          latestText: 'Switching to the docs repo on this same task.',
          draftRevision: 5,
          sourceMessageId: 'source-1',
          responseMessageId: 'running-response-terminal-race',
          surfaceAttached: true,
          overflowMessageIds: [],
          linkedArtifactMessageIds: [],
        },
        files: [],
      };
    });

    await handleMessageCreate(message);

    expect(mockQueueActiveRunUserInterrupt).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-running-terminal-race',
        userId: 'user-456',
        messageId: message.id,
      }),
    );
    expect(mockContinueMatchedTaskRunWithInput).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-running-terminal-race',
        userId: 'user-456',
        userText: 'switch the search to the docs repo',
      }),
    );
    expect(referencedMessage.edit).toHaveBeenCalled();
    expect(message.reply).not.toHaveBeenCalled();
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
    expect(mockResumeWaitingTaskRunWithInput).not.toHaveBeenCalled();
  });

  it('reroutes a stale active-run interrupt into waiting-user-input resume when the matched task entered a waiting state first', async () => {
    const message = createMockMessage({
      content: 'sage use the docs repo',
      reference: { messageId: 'running-response-became-waiting' },
      fetchReference: vi.fn().mockResolvedValue(null),
    });
    mockFindRunningTaskRunForActiveInterrupt.mockResolvedValueOnce({
      id: 'run-running-became-waiting',
      threadId: 'thread-running-became-waiting',
      sourceMessageId: 'source-1',
      responseMessageId: 'running-response-became-waiting',
      status: 'running',
    });
    mockQueueActiveRunUserInterrupt.mockResolvedValueOnce('stale');
    mockGetAgentTaskRunByThreadId.mockResolvedValueOnce({
      id: 'run-running-became-waiting',
      threadId: 'thread-running-became-waiting',
      sourceMessageId: 'source-1',
      responseMessageId: 'running-response-became-waiting',
      status: 'waiting_user_input',
      waitingKind: 'user_input',
      responseSessionJson: {
        responseSessionId: 'thread-running-became-waiting',
        status: 'waiting_user_input',
        latestText: 'Which repo should I check?',
        draftRevision: 4,
        sourceMessageId: 'source-1',
        responseMessageId: 'running-response-became-waiting',
        surfaceAttached: true,
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
    });

    await handleMessageCreate(message);

    expect(mockResumeWaitingTaskRunWithInput).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'test-trace-id',
        replyToMessageId: 'running-response-became-waiting',
        userText: 'use the docs repo',
      }),
    );
    expect(mockContinueMatchedTaskRunWithInput).not.toHaveBeenCalled();
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
  });

  it('fails closed when a stale completed-task continuation cannot rehydrate the canonical response surface', async () => {
    const message = createMockMessage({
      content: 'sage switch to the docs repo',
      reference: { messageId: 'running-response-missing-surface' },
      fetchReference: vi.fn().mockResolvedValue(null),
    }) as Message & {
      __responseMessage: { id: string; edit: ReturnType<typeof vi.fn> };
      __sourceMessage: { id: string; reply: ReturnType<typeof vi.fn> };
      channel: {
        messages: { fetch: ReturnType<typeof vi.fn> };
      };
      reply: ReturnType<typeof vi.fn>;
    };
    message.channel.messages.fetch.mockImplementation(async (messageId: string) => {
      if (messageId === message.__responseMessage.id) {
        return message.__responseMessage;
      }
      if (messageId === message.__sourceMessage.id) {
        return message.__sourceMessage;
      }
      throw new Error(`Unknown message id: ${messageId}`);
    });
    mockFindRunningTaskRunForActiveInterrupt.mockResolvedValueOnce({
      id: 'run-running-missing-surface',
      threadId: 'thread-running-missing-surface',
      sourceMessageId: 'source-1',
      responseMessageId: 'running-response-missing-surface',
      status: 'running',
    });
    mockQueueActiveRunUserInterrupt.mockResolvedValueOnce('stale');
    mockGetAgentTaskRunByThreadId.mockResolvedValueOnce({
      id: 'run-running-missing-surface',
      threadId: 'thread-running-missing-surface',
      sourceMessageId: 'source-1',
      responseMessageId: 'running-response-missing-surface',
      status: 'completed',
      completionKind: 'final_answer',
      responseSessionJson: {
        responseSessionId: 'thread-running-missing-surface',
        status: 'final',
        latestText: 'Still working on that.',
        draftRevision: 4,
        sourceMessageId: 'source-1',
        responseMessageId: 'running-response-missing-surface',
        surfaceAttached: true,
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
    });

    await handleMessageCreate(message);

    expect(mockContinueMatchedTaskRunWithInput).not.toHaveBeenCalled();
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting-user-input replies on the existing waiting resume path even if a running task would also match', async () => {
    const referencedMessage = {
      id: 'waiting-response-1',
      author: {
        id: '123',
        bot: true,
        username: 'SageBot',
      } as User,
      member: null,
      guildId: 'guild-789',
      channelId: 'channel-101',
      reference: null,
      mentions: {
        users: new Collection<string, User>(),
      } as Message['mentions'],
      content: 'What repo should I inspect?',
    } as Partial<Message>;
    const message = createMockMessage({
      content: 'sage use the second repo',
      reference: { messageId: 'waiting-response-1' },
      fetchReference: vi.fn().mockResolvedValue(referencedMessage),
    });
    mockFindWaitingUserInputTaskRun.mockResolvedValueOnce({
      id: 'run-waiting-1',
      threadId: 'thread-waiting-1',
      sourceMessageId: 'source-1',
      responseMessageId: 'waiting-response-1',
      waitingKind: 'user_input',
      status: 'waiting_user_input',
    });
    mockFindRunningTaskRunForActiveInterrupt.mockResolvedValueOnce({
      id: 'run-running-2',
      threadId: 'thread-running-2',
      sourceMessageId: 'source-1',
      responseMessageId: 'waiting-response-1',
      status: 'running',
    });

    await handleMessageCreate(message);

    expect(mockResumeWaitingTaskRunWithInput).toHaveBeenCalledTimes(1);
    expect(mockQueueActiveRunUserInterrupt).not.toHaveBeenCalled();
  });

  it('resumes a waiting task from the raw Discord reply id even when reference hydration fails', async () => {
    const message = createMockMessage({
      content: 'Proceed',
      reference: { messageId: 'waiting-response-fetch-failed' },
      fetchReference: vi.fn().mockRejectedValue(new Error('reference fetch failed')),
    });
    mockFindWaitingUserInputTaskRun.mockResolvedValueOnce({
      id: 'run-waiting-fetch-failed',
      threadId: 'thread-waiting-fetch-failed',
      sourceMessageId: 'source-1',
      responseMessageId: null,
      responseSessionJson: {
        responseSessionId: 'thread-waiting-fetch-failed',
        status: 'waiting_user_input',
        latestText: 'Which repo should I inspect?',
        draftRevision: 2,
        sourceMessageId: 'source-1',
        responseMessageId: 'waiting-response-fetch-failed',
        linkedArtifactMessageIds: [],
      },
      waitingKind: 'user_input',
      status: 'waiting_user_input',
    });

    await handleMessageCreate(message);

    expect(mockFindWaitingUserInputTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        replyToMessageId: 'waiting-response-fetch-failed',
      }),
    );
    expect(mockResumeWaitingTaskRunWithInput).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
  });

  it('queues active-run steering from the raw Discord reply id even when reference hydration fails', async () => {
    const message = createMockMessage({
      content: 'sage switch to the docs repo instead',
      reference: { messageId: 'running-response-fetch-failed' },
      fetchReference: vi.fn().mockRejectedValue(new Error('reference fetch failed')),
    });
    mockFindRunningTaskRunForActiveInterrupt.mockResolvedValueOnce({
      id: 'run-running-fetch-failed',
      threadId: 'thread-running-fetch-failed',
      sourceMessageId: 'source-1',
      responseMessageId: 'running-response-fetch-failed',
      status: 'running',
    });

    await handleMessageCreate(message);

    expect(mockFindRunningTaskRunForActiveInterrupt).toHaveBeenCalledWith(
      expect.objectContaining({
        replyToMessageId: 'running-response-fetch-failed',
      }),
    );
    expect(mockQueueActiveRunUserInterrupt).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-running-fetch-failed',
        userId: 'user-456',
        messageId: message.id,
        userText: 'switch to the docs repo instead',
      }),
    );
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
  });

  it('ignores the old waiting draft message after restart and replies on the current follow-up instead', async () => {
    const message = createMockMessage({
      content: 'sage deep dive this',
    }) as unknown as Message & {
      __responseMessage: { id: string; edit: ReturnType<typeof vi.fn> };
      __sourceMessage: { id: string };
      reply: ReturnType<typeof vi.fn>;
    };
    mockFindWaitingUserInputTaskRun.mockResolvedValueOnce({
      id: 'run-2',
      threadId: 'thread-restart-existing',
      sourceMessageId: message.__sourceMessage.id,
      responseMessageId: null,
      responseSessionJson: {
        responseSessionId: 'thread-restart-existing',
        status: 'draft',
        latestText: 'Existing draft',
        draftRevision: 1,
        sourceMessageId: message.__sourceMessage.id,
        responseMessageId: message.__responseMessage.id,
        linkedArtifactMessageIds: [],
      },
    });
    mockResumeWaitingTaskRunWithInput.mockImplementationOnce(async (params) => {
      await params.onResponseSessionUpdate?.({
        replyText: 'Updated after restart',
        delivery: 'response_session',
        responseSession: {
          responseSessionId: 'thread-restart-existing',
          status: 'draft',
          latestText: 'Updated after restart',
          draftRevision: 2,
          sourceMessageId: message.__sourceMessage.id,
          responseMessageId: null,
          linkedArtifactMessageIds: [],
        },
        pendingInterrupt: null,
        completionKind: null,
        stopReason: 'background_yield',
      });

      return {
        runId: 'thread-restart-existing',
        status: 'completed',
        replyText: 'Updated after restart',
        delivery: 'response_session',
        responseSession: {
          responseSessionId: 'thread-restart-existing',
          status: 'final',
          latestText: 'Updated after restart',
          draftRevision: 2,
          sourceMessageId: message.__sourceMessage.id,
          responseMessageId: null,
          linkedArtifactMessageIds: [],
        },
        files: [],
      };
    });

    await handleMessageCreate(message);

    expect(message.reply).toHaveBeenCalled();
    expect(message.__responseMessage.edit).not.toHaveBeenCalled();
    expect(mockAttachTaskRunResponseSession).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-restart-existing',
        sourceMessageId: message.id,
        responseMessageId: message.__responseMessage.id,
        responseSession: expect.objectContaining({
          sourceMessageId: message.id,
          overflowMessageIds: [],
        }),
      }),
    );
  });

  it('replies to the current follow-up when the original waiting draft message is missing', async () => {
    const message = createMockMessage({
      content: 'sage here is more detail',
    }) as unknown as Message & {
      __responseMessage: { id: string; edit: ReturnType<typeof vi.fn> };
      __sourceMessage: { id: string; reply: ReturnType<typeof vi.fn> };
      reply: ReturnType<typeof vi.fn>;
      channel: {
        messages: { fetch: ReturnType<typeof vi.fn> };
      };
    };
    message.channel.messages.fetch.mockImplementation(async (messageId: string) => {
      if (messageId === message.__sourceMessage.id) {
        return message.__sourceMessage;
      }
      throw new Error(`Unknown message id: ${messageId}`);
    });
    mockFindWaitingUserInputTaskRun.mockResolvedValueOnce({
      id: 'run-4',
      threadId: 'thread-missing-response-message',
      sourceMessageId: message.__sourceMessage.id,
      responseMessageId: 'missing-response-message',
      responseSessionJson: {
        responseSessionId: 'thread-missing-response-message',
        status: 'draft',
        latestText: 'Need your follow-up',
        draftRevision: 1,
        sourceMessageId: message.__sourceMessage.id,
        responseMessageId: 'missing-response-message',
        linkedArtifactMessageIds: [],
      },
    });
    mockResumeWaitingTaskRunWithInput.mockImplementationOnce(async (params) => {
      await params.onResponseSessionUpdate?.({
        replyText: 'Thanks, continuing now.',
        delivery: 'response_session',
        responseSession: {
          responseSessionId: 'thread-missing-response-message',
          status: 'draft',
          latestText: 'Thanks, continuing now.',
          draftRevision: 2,
          sourceMessageId: message.__sourceMessage.id,
          responseMessageId: null,
          linkedArtifactMessageIds: [],
        },
        pendingInterrupt: null,
        completionKind: null,
        stopReason: 'background_yield',
      });

      return {
        runId: 'thread-missing-response-message',
        status: 'completed',
        replyText: 'Thanks, continuing now.',
        delivery: 'response_session',
        responseSession: {
          responseSessionId: 'thread-missing-response-message',
          status: 'final',
          latestText: 'Thanks, continuing now.',
          draftRevision: 2,
          sourceMessageId: message.__sourceMessage.id,
          responseMessageId: null,
          linkedArtifactMessageIds: [],
        },
        files: [],
      };
    });

    await handleMessageCreate(message);

    expect(message.reply).toHaveBeenCalled();
    expect(message.__sourceMessage.reply).not.toHaveBeenCalled();
  });

  it('reconciles long overflow chunks during waiting-run resumes instead of sending duplicate tail messages', async () => {
    const longDraft = `${'A'.repeat(2_000)}${'B'.repeat(2_000)}${'C'.repeat(200)}`;
    const message = createMockMessage({
      content: 'sage continue',
    }) as unknown as Message & {
      __responseMessage: {
        id: string;
        content: string;
        edit: ReturnType<typeof vi.fn>;
        reply: ReturnType<typeof vi.fn>;
      };
      __sourceMessage: { id: string };
      reply: ReturnType<typeof vi.fn>;
      channel: {
        send: ReturnType<typeof vi.fn>;
      };
    };

    mockFindWaitingUserInputTaskRun.mockResolvedValueOnce({
      id: 'run-long-overflow',
      threadId: 'thread-long-overflow',
      sourceMessageId: message.__sourceMessage.id,
      responseMessageId: message.__responseMessage.id,
      responseSessionJson: {
        responseSessionId: 'thread-long-overflow',
        status: 'draft',
        latestText: '',
        draftRevision: 0,
        sourceMessageId: message.__sourceMessage.id,
        responseMessageId: message.__responseMessage.id,
        linkedArtifactMessageIds: [],
      },
    });
    mockResumeWaitingTaskRunWithInput.mockImplementationOnce(async (params) => {
      await params.onResponseSessionUpdate?.({
        replyText: longDraft,
        delivery: 'response_session',
        responseSession: {
          responseSessionId: 'thread-long-overflow',
          status: 'draft',
          latestText: longDraft,
          draftRevision: 1,
          sourceMessageId: message.__sourceMessage.id,
          responseMessageId: message.__responseMessage.id,
          linkedArtifactMessageIds: [],
        },
        pendingInterrupt: null,
        completionKind: null,
        stopReason: 'background_yield',
      });

      return {
        runId: 'thread-long-overflow',
        status: 'completed',
        replyText: longDraft,
        delivery: 'response_session',
        responseSession: {
          responseSessionId: 'thread-long-overflow',
          status: 'final',
          latestText: longDraft,
          draftRevision: 1,
          sourceMessageId: message.__sourceMessage.id,
          responseMessageId: message.__responseMessage.id,
          linkedArtifactMessageIds: [],
        },
        files: [],
      };
    });

    await handleMessageCreate(message);

    const firstOverflowMessage = await message.__responseMessage.reply.mock.results[0]?.value;
    expect(message.channel.send).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(message.__responseMessage.edit).not.toHaveBeenCalled();
    expect(message.__responseMessage.reply).toHaveBeenCalledTimes(1);
    expect(message.__responseMessage.reply).toHaveBeenCalledWith({
      content: `${'B'.repeat(2_000)}`,
      allowedMentions: { repliedUser: false },
    });
    expect(firstOverflowMessage.reply).toHaveBeenCalledTimes(1);
    expect(firstOverflowMessage.reply).toHaveBeenCalledWith({
      content: `${'C'.repeat(200)}`,
      allowedMentions: { repliedUser: false },
    });
  });

  it('rebuilds missing overflow chunks when a resumed long draft replays the same full text after restart', async () => {
    const longDraft = `${'A'.repeat(2_000)}${'B'.repeat(2_000)}${'C'.repeat(200)}`;
    const message = createMockMessage({
      content: 'sage continue',
    }) as unknown as Message & {
      __responseMessage: {
        id: string;
        content: string;
        edit: ReturnType<typeof vi.fn>;
        reply: ReturnType<typeof vi.fn>;
      };
      __sourceMessage: { id: string };
      reply: ReturnType<typeof vi.fn>;
      channel: {
        send: ReturnType<typeof vi.fn>;
      };
    };
    message.__responseMessage.content = 'A'.repeat(2_000);

    mockFindWaitingUserInputTaskRun.mockResolvedValueOnce({
      id: 'run-replay-missing-overflow',
      threadId: 'thread-replay-missing-overflow',
      sourceMessageId: message.__sourceMessage.id,
      responseMessageId: message.__responseMessage.id,
      responseSessionJson: {
        responseSessionId: 'thread-replay-missing-overflow',
        status: 'draft',
        latestText: longDraft,
        draftRevision: 4,
        sourceMessageId: message.__sourceMessage.id,
        responseMessageId: message.__responseMessage.id,
        overflowMessageIds: [],
        linkedArtifactMessageIds: [],
      },
    });
    mockResumeWaitingTaskRunWithInput.mockImplementationOnce(async (params) => {
      await params.onResponseSessionUpdate?.({
        replyText: longDraft,
        delivery: 'response_session',
        responseSession: {
          responseSessionId: 'thread-replay-missing-overflow',
          status: 'draft',
          latestText: longDraft,
          draftRevision: 5,
          sourceMessageId: message.__sourceMessage.id,
          responseMessageId: message.__responseMessage.id,
          linkedArtifactMessageIds: [],
        },
        pendingInterrupt: null,
        completionKind: null,
        stopReason: 'background_yield',
      });

      return {
        runId: 'thread-replay-missing-overflow',
        status: 'completed',
        replyText: longDraft,
        delivery: 'response_session',
        responseSession: {
          responseSessionId: 'thread-replay-missing-overflow',
          status: 'final',
          latestText: longDraft,
          draftRevision: 5,
          sourceMessageId: message.__sourceMessage.id,
          responseMessageId: message.__responseMessage.id,
          linkedArtifactMessageIds: [],
        },
        files: [],
      };
    });

    await handleMessageCreate(message);

    const firstOverflowMessage = await message.__responseMessage.reply.mock.results[0]?.value;
    expect(message.channel.send).not.toHaveBeenCalled();
    expect(message.__responseMessage.edit).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(message.__responseMessage.reply).toHaveBeenCalledTimes(1);
    expect(firstOverflowMessage.reply).toHaveBeenCalledTimes(1);
  });

  it('reconciles overflow chunks when a long final reply uses a runtime card', async () => {
    const longDraft = `${'A'.repeat(2_000)}${'B'.repeat(2_000)}${'C'.repeat(200)}`;
    const message = createMockMessage({
      content: 'sage continue',
    }) as unknown as Message & {
      __responseMessage: {
        id: string;
        content: string;
        edit: ReturnType<typeof vi.fn>;
        reply: ReturnType<typeof vi.fn>;
      };
      __sourceMessage: { id: string };
      reply: ReturnType<typeof vi.fn>;
      channel: {
        send: ReturnType<typeof vi.fn>;
      };
    };

    mockFindWaitingUserInputTaskRun.mockResolvedValueOnce({
      id: 'run-long-card-overflow',
      threadId: 'thread-long-card-overflow',
      sourceMessageId: message.__sourceMessage.id,
      responseMessageId: message.__responseMessage.id,
      responseSessionJson: {
        responseSessionId: 'thread-long-card-overflow',
        status: 'draft',
        latestText: '',
        draftRevision: 0,
        sourceMessageId: message.__sourceMessage.id,
        responseMessageId: message.__responseMessage.id,
        linkedArtifactMessageIds: [],
      },
    });
    mockResumeWaitingTaskRunWithInput.mockImplementationOnce(async (params) => {
      await params.onResponseSessionUpdate?.({
        replyText: longDraft,
        delivery: 'response_session',
        responseSession: {
          responseSessionId: 'thread-long-card-overflow',
          status: 'draft',
          latestText: longDraft,
          draftRevision: 1,
          sourceMessageId: message.__sourceMessage.id,
          responseMessageId: message.__responseMessage.id,
          linkedArtifactMessageIds: [],
        },
        pendingInterrupt: null,
        completionKind: null,
        stopReason: 'background_yield',
      });

      return {
        runId: 'thread-long-card-overflow',
        status: 'completed',
        replyText: longDraft,
        delivery: 'response_session',
        meta: {
          retry: {
            threadId: 'thread-long-card-overflow',
            retryKind: 'turn',
          },
        },
        responseSession: {
          responseSessionId: 'thread-long-card-overflow',
          status: 'final',
          latestText: longDraft,
          draftRevision: 2,
          sourceMessageId: message.__sourceMessage.id,
          responseMessageId: message.__responseMessage.id,
          linkedArtifactMessageIds: [],
        },
        files: [],
      };
    });

    await handleMessageCreate(message);

    expect(mockCreateInteractiveButtonSession).toHaveBeenCalled();
    const firstOverflowMessage = await message.__responseMessage.reply.mock.results[0]?.value;
    expect(message.channel.send).not.toHaveBeenCalled();
    expect(message.__responseMessage.edit).toHaveBeenCalledTimes(1);
    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(message.__responseMessage.reply).toHaveBeenCalledTimes(1);
    expect(firstOverflowMessage.reply).toHaveBeenCalledTimes(1);
  });

  it('attaches a Retry button when the runtime returns retry metadata', async () => {
    mockGenerateChatReply.mockResolvedValueOnce({
      replyText: 'I lost the model connection before I could finish, so please try again.',
      delivery: 'response_session',
      meta: {
        retry: {
          threadId: 'thread-retry-1',
          retryKind: 'turn',
        },
      },
      files: [],
    });

    const message = createMockMessage({
      content: 'sage hello',
    });

    await handleMessageCreate(message);

    expect(mockCreateInteractiveButtonSession).toHaveBeenCalledWith({
      guildId: 'guild-789',
      channelId: 'channel-101',
      createdByUserId: 'user-456',
      action: {
        type: 'graph_retry',
        threadId: 'thread-retry-1',
        retryKind: 'turn',
        visibility: 'public',
      },
    });
    expect((message as unknown as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: 32768,
        components: [
          expect.objectContaining({
            type: 17,
            components: expect.arrayContaining([
              expect.objectContaining({
                content:
                  'I lost the model connection before I could finish, so please try again.',
              }),
              expect.objectContaining({
                type: 1,
                components: [
                  expect.objectContaining({
                    custom_id: 'sage:ui:continue-1',
                    label: 'Retry',
                  }),
                ],
              }),
            ]),
          }),
        ],
      }),
    );
  });

  it('calls generateChatReply for wakeword-only image messages (default prompt)', async () => {
    const message = createMockMessage({
      content: 'sage',
      attachments: {
        values: vi.fn(() => [
          {
            name: 'image.png',
            url: 'https://cdn.discordapp.com/attachments/1/2/image.png',
            contentType: 'image/png',
            size: 1234,
          },
        ]),
        first: vi.fn(() => null),
      },
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        promptMode: 'image_only',
        userText: expect.stringContaining(
          'Inspect the attached image and either answer the implied request or ask one short clarification if the intent is still unclear.',
        ),
      }),
    );
  });

  it('applies wakeword cooldown per user/channel', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    const firstMessage = createMockMessage({
      content: 'sage summarize this',
      channelId: 'channel-cooldown',
    });

    const secondMessage = createMockMessage({
      content: 'sage summarize again',
      channelId: 'channel-cooldown',
    });

    await handleMessageCreate(firstMessage);
    await handleMessageCreate(secondMessage);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    expect(mockIngestEvent).toHaveBeenCalledTimes(2);
  });

  it('ignores mid-sentence wakeword mentions', async () => {
    const message = createMockMessage({
      content: 'I met Sage yesterday at the park',
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).not.toHaveBeenCalled();
    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: message.id }),
    );
  });

  it('calls generateChatReply for mentions', async () => {
    const message = createMockMessage({
      content: '<@123> Hello!',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
    });

    await handleMessageCreate(message);

    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: message.id }),
    );
    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    expect((message as unknown as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalled();
  });

  it('calls generateChatReply for bare mention invocations', async () => {
    const message = createMockMessage({
      content: '<@123>',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        invokedBy: 'mention',
        promptMode: 'direct_attention',
        userText:
          'The user explicitly invoked Sage without a concrete task yet. Briefly acknowledge them and ask what they need help with.',
      }),
    );
  });

  it('calls generateChatReply for mention-only image messages (default prompt)', async () => {
    const message = createMockMessage({
      content: '<@123>',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      attachments: {
        values: vi.fn(() => [
          {
            name: 'image.png',
            url: 'https://cdn.discordapp.com/attachments/1/2/image.png',
            contentType: 'image/png',
            size: 1234,
          },
        ]),
        first: vi.fn(() => null),
      },
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    const call = mockGenerateChatReply.mock.calls[0]?.[0] as { userText?: string; userContent?: unknown };
    expect(call.userText).toContain(
      'Inspect the attached image and either answer the implied request or ask one short clarification if the intent is still unclear.',
    );
    expect(call.userText).toContain('attachment:attachment-row-default');
    expect(Array.isArray(call.userContent)).toBe(true);
    const parts = call.userContent as Array<{ type?: string; image_url?: { url?: string } }>;
    expect(parts.some((part) => part.type === 'image_url')).toBe(true);
    expect(
      parts.find((part) => part.type === 'image_url')?.image_url?.url,
    ).toBe('https://cdn.discordapp.com/attachments/1/2/image.png');
  });

  it('includes embed image URLs as multimodal content', async () => {
    const message = createMockMessage({
      content: '<@123> what is this?',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      embeds: [
        {
          image: { url: 'https://example.com/embed.png' },
        },
      ],
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    const call = mockGenerateChatReply.mock.calls[0]?.[0] as { userContent?: unknown };
    expect(Array.isArray(call.userContent)).toBe(true);
    const parts = call.userContent as Array<{ type?: string; image_url?: { url?: string } }>;
    expect(
      parts.find((part) => part.type === 'image_url')?.image_url?.url,
    ).toBe('https://example.com/embed.png');
  });

  it('includes direct image URLs as multimodal content', async () => {
    const message = createMockMessage({
      content: '<@123> https://example.com/direct.png',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    const call = mockGenerateChatReply.mock.calls[0]?.[0] as { userContent?: unknown };
    expect(Array.isArray(call.userContent)).toBe(true);
    const parts = call.userContent as Array<{ type?: string; image_url?: { url?: string } }>;
    expect(
      parts.find((part) => part.type === 'image_url')?.image_url?.url,
    ).toBe('https://example.com/direct.png');
  });

  it('skips reply generation when channel cannot send typing updates', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const message = createMockMessage({
      content: '<@123> Hello!',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      channel: {} as unknown as TextChannel,
      reply,
    });

    await handleMessageCreate(message);

    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: message.id }),
    );
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('passes non-bot mention ids consistently to ingest and reply generation', async () => {
    const mentionedA = {
      id: 'user-a',
      bot: false,
      username: 'UserA',
    } as unknown as User;
    const mentionedB = {
      id: 'user-b',
      bot: false,
      username: 'UserB',
    } as unknown as User;
    const botMention = {
      id: '123',
      bot: true,
      username: 'SageBot',
    } as unknown as User;

    const message = createMockMessage({
      content: '<@123> hey <@user-a> and <@user-b>',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>([
          ['123', botMention],
          ['user-a', mentionedA],
          ['user-b', mentionedB],
        ]),
      },
    });

    await handleMessageCreate(message);

    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionsUserIds: ['user-a', 'user-b'],
      }),
    );
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionedUserIds: ['user-a', 'user-b'],
      }),
    );
  });

  it('treats replies as replies even when mentioning the bot', async () => {
    const fetchReference = vi.fn().mockResolvedValue({
      id: 'ref-1',
      guildId: 'guild-789',
      channelId: 'channel-101',
      author: { id: '123', bot: true },
      member: null,
      content: 'Prior bot message',
      mentions: {
        users: new Map<string, User>(),
      },
      reference: null,
      attachments: {
        first: vi.fn(() => null),
        values: vi.fn(() => []),
      },
      partial: false,
    });

    const message = createMockMessage({
      content: '<@123> following up on your reply',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      reference: { messageId: 'ref-1' },
      fetchReference,
    });

    await handleMessageCreate(message);

    expect(fetchReference).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        currentTurn: expect.objectContaining({
          invokedBy: 'reply',
          isDirectReply: true,
          replyTargetAuthorId: '123',
        }),
        replyTarget: expect.objectContaining({
          authorId: '123',
          authorIsBot: true,
          content: 'Prior bot message',
        }),
      }),
    );
  });

  it('calls generateChatReply for empty replies to Sage with the canonical reply-only prompt adapter', async () => {
    const referencedMessage = {
      id: 'ref-empty-1',
      guildId: 'guild-789',
      channelId: 'channel-101',
      author: { id: '123', bot: true, username: 'SageBot' },
      member: null,
      content: 'Can you summarize that thread?',
      mentions: {
        users: new Map<string, User>(),
      },
      reference: null,
      attachments: {
        first: vi.fn(() => null),
        values: vi.fn(() => []),
      },
      partial: false,
    };

    const message = createMockMessage({
      content: '',
      reference: { messageId: 'ref-empty-1' },
      referencedMessage,
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        invokedBy: 'reply',
        promptMode: 'reply_only',
        userText:
          'The user replied without adding new text. Use the reply target as context, stay narrow, and ask one short clarification if the intent is still unclear.',
        replyTarget: expect.objectContaining({
          messageId: 'ref-empty-1',
        }),
      }),
    );
  });

  it('uses the canonical reply-only prompt adapter for empty mentions that directly reply to another human', async () => {
    const referencedMessage = {
      id: 'ref-empty-human-1',
      guildId: 'guild-789',
      channelId: 'channel-101',
      author: { id: 'user-999', bot: false, username: 'OtherUser' },
      member: null,
      content: 'Can someone summarize this thread?',
      mentions: {
        users: new Map<string, User>(),
      },
      reference: null,
      attachments: {
        first: vi.fn(() => null),
        values: vi.fn(() => []),
      },
      partial: false,
    };

    const message = createMockMessage({
      content: '<@123>',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      reference: { messageId: 'ref-empty-human-1' },
      referencedMessage,
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        invokedBy: 'mention',
        promptMode: 'reply_only',
        userText:
          'The user replied without adding new text. Use the reply target as context, stay narrow, and ask one short clarification if the intent is still unclear.',
        currentTurn: expect.objectContaining({
          invokedBy: 'mention',
          isDirectReply: true,
          replyTargetAuthorId: 'user-999',
        }),
        replyTarget: expect.objectContaining({
          messageId: 'ref-empty-human-1',
          authorId: 'user-999',
          authorIsBot: false,
        }),
      }),
    );
  });

  it('strips a redundant leading wake word from reply text before invoking Sage', async () => {
    const referencedMessage = {
      id: 'ref-redundant-1',
      guildId: 'guild-789',
      channelId: 'channel-101',
      author: { id: '123', bot: true, username: 'SageBot' },
      member: null,
      content: 'Previous Sage message',
      mentions: {
        users: new Map<string, User>(),
      },
      reference: null,
      attachments: {
        first: vi.fn(() => null),
        values: vi.fn(() => []),
      },
      partial: false,
    };

    const message = createMockMessage({
      content: 'sage keep going from there',
      reference: { messageId: 'ref-redundant-1' },
      referencedMessage,
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        invokedBy: 'reply',
        userText: 'keep going from there',
      }),
    );
  });

  it('includes reply reference content', async () => {
    const referencedMessage = {
      id: 'ref-2',
      guildId: 'guild-1',
      channelId: 'channel-1',
      author: { id: 'user-999', bot: false, username: 'Reply User' },
      member: null,
      content: 'Original question',
      mentions: {
        users: new Map<string, User>(),
      },
      reference: null,
      attachments: {
        first: vi.fn(() => null),
        values: vi.fn(() => []),
      },
      partial: false,
    };

    const message = createMockMessage({
      content: '<@123> follow up',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      reference: { messageId: 'ref-2' },
      referencedMessage,
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTarget: expect.objectContaining({
          messageId: 'ref-2',
          authorId: 'user-999',
          content: 'Original question',
        }),
      }),
    );
  });

  it('includes reply reference images as multimodal content', async () => {
    const referencedMessage = {
      id: 'ref-3',
      guildId: 'guild-1',
      channelId: 'channel-1',
      author: { id: 'user-999', bot: false, username: 'Reply User' },
      member: null,
      content: '',
      mentions: {
        users: new Map<string, User>(),
      },
      reference: null,
      attachments: {
        first: vi.fn(() => ({
          contentType: 'image/png',
          url: 'https://cdn.example.com/image.png',
        })),
        values: vi.fn(() => [
          {
            contentType: 'image/png',
            url: 'https://cdn.example.com/image.png',
          },
        ]),
      },
      partial: false,
    };

    const message = createMockMessage({
      content: '<@123> what do you think?',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      reference: { messageId: 'ref-3' },
      referencedMessage,
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTarget: expect.objectContaining({
          content: [
            { type: 'text', text: ' ' },
            { type: 'image_url', image_url: { url: 'https://cdn.example.com/image.png' } },
          ],
        }),
      }),
    );
  });

  it('ingests bot messages but skips reply generation', async () => {
    const message = createMockMessage({
      author: {
        id: 'other-bot',
        bot: true,
        username: 'Bot',
      },
    });

    await handleMessageCreate(message);

    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: message.id,
        authorIsBot: true,
      }),
    );
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
  });

  it('ingests visible Components V2 text from bot-authored messages', async () => {
    const message = createMockMessage({
      content: '',
      author: {
        id: 'other-bot',
        bot: true,
        username: 'Bot',
      },
      components: [
        {
          type: 17,
          components: [
            {
              type: 10,
              content: 'Approval finished successfully.',
            },
            {
              type: 1,
              components: [
                {
                  type: 2,
                  label: 'Continue',
                },
              ],
            },
          ],
        },
      ],
    });

    await handleMessageCreate(message);

    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: message.id,
        authorIsBot: true,
        content: 'Approval finished successfully.',
      }),
    );
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
  });

  it('uses visible Components V2 text for bot reply targets', async () => {
    const referencedMessage = {
      id: 'ref-components-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      author: { id: '123', bot: true, username: 'SageBot' },
      member: null,
      content: '',
      components: [
        {
          type: 17,
          components: [
            {
              type: 10,
              content: 'I finished the approval flow and posted the outcome.',
            },
          ],
        },
      ],
      mentions: {
        users: new Map<string, User>(),
      },
      reference: null,
      attachments: {
        first: vi.fn(() => null),
        values: vi.fn(() => []),
      },
      partial: false,
    };

    const message = createMockMessage({
      content: '<@123> can you check that again?',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      reference: { messageId: 'ref-components-1' },
      referencedMessage,
    });

    await handleMessageCreate(message);

    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTarget: expect.objectContaining({
          content: 'I finished the approval flow and posted the outcome.',
        }),
      }),
    );
  });

  it('ingests bot mentions to Sage but still skips reply generation', async () => {
    const message = createMockMessage({
      content: '<@123> status update from another bot',
      author: {
        id: 'other-bot',
        bot: true,
        username: 'Bot',
      },
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
    });

    await handleMessageCreate(message);

    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: message.id,
        authorIsBot: true,
        mentionsBot: true,
      }),
    );
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
  });

  it('ingests non-mention messages even though bot does not reply', async () => {
    const message = createMockMessage({
      content: 'Just chatting without mentioning bot',
    });

    await handleMessageCreate(message);

    expect(mockIngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: message.id }),
    );
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
  });

  it('ingests and forwards multiple non-image attachments', async () => {
    mockFetchAttachmentText
      .mockResolvedValueOnce({
        kind: 'ok',
        text: 'alpha body',
        extractor: 'tika',
        byteLength: 20,
        mimeType: 'text/plain',
      })
      .mockResolvedValueOnce({
        kind: 'ok',
        text: 'beta body',
        extractor: 'tika',
        byteLength: 24,
        mimeType: 'text/markdown',
      });
    mockUpsertIngestedAttachment
      .mockResolvedValueOnce({ id: 'attachment-row-alpha' })
      .mockResolvedValueOnce({ id: 'attachment-row-beta' });

    const message = createMockMessage({
      content: '<@123> review these',
      channelId: 'channel-files',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      attachments: {
        values: vi.fn(() => [
          {
            name: 'alpha.txt',
            url: 'https://cdn.discordapp.com/alpha.txt',
            contentType: 'text/plain',
            size: 20,
          },
          {
            name: 'beta.md',
            url: 'https://cdn.discordapp.com/beta.md',
            contentType: 'text/markdown',
            size: 24,
          },
        ]),
        first: vi.fn(() => null),
      },
    });

    await handleMessageCreate(message);

    expect(mockFetchAttachmentText).toHaveBeenCalledTimes(2);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: expect.stringContaining('BEGIN FILE ATTACHMENT: alpha.txt'),
      }),
    );
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: expect.stringContaining('BEGIN FILE ATTACHMENT: beta.md'),
      }),
    );

    expect(mockIngestEvent).toHaveBeenCalledTimes(1);
    const ingestPayload = mockIngestEvent.mock.calls[0]?.[0] as { content?: string };
    expect(ingestPayload.content).toContain('Attachment cache processed 2 attachment(s); cached attachments: 2.');
    expect(ingestPayload.content).toContain('Cached attachment references');
    expect(ingestPayload.content).toContain('discord_files_read_attachment');
    expect(ingestPayload.content).toContain('discord_files_send_attachment');
    expect(ingestPayload.content).toContain('attachment:attachment-row-alpha');
    expect(ingestPayload.content).not.toContain('BEGIN FILE ATTACHMENT');
  });

  it('keeps uncached images out of the per-message file ingest cap', async () => {
    config.FILE_INGEST_MAX_ATTACHMENTS_PER_MESSAGE = 3;
    mockIsLoggingEnabled.mockReturnValue(false);
    mockFetchAttachmentText
      .mockResolvedValueOnce({
        kind: 'ok',
        text: 'alpha pdf',
        extractor: 'tika',
        byteLength: 20,
        mimeType: 'application/pdf',
      })
      .mockResolvedValueOnce({
        kind: 'ok',
        text: 'beta pdf',
        extractor: 'tika',
        byteLength: 24,
        mimeType: 'application/pdf',
      })
      .mockResolvedValueOnce({
        kind: 'ok',
        text: 'gamma pdf',
        extractor: 'tika',
        byteLength: 28,
        mimeType: 'application/pdf',
      });

    const message = createMockMessage({
      content: '<@123> review these files',
      channelId: 'channel-no-cache',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      attachments: {
        values: vi.fn(() => [
          {
            name: 'preview.png',
            url: 'https://cdn.discordapp.com/preview.png',
            contentType: 'image/png',
            size: 12,
          },
          {
            name: 'alpha.pdf',
            url: 'https://cdn.discordapp.com/alpha.pdf',
            contentType: 'application/pdf',
            size: 20,
          },
          {
            name: 'beta.pdf',
            url: 'https://cdn.discordapp.com/beta.pdf',
            contentType: 'application/pdf',
            size: 24,
          },
          {
            name: 'gamma.pdf',
            url: 'https://cdn.discordapp.com/gamma.pdf',
            contentType: 'application/pdf',
            size: 28,
          },
        ]),
        first: vi.fn(() => null),
      },
    });

    await handleMessageCreate(message);

    expect(mockFetchAttachmentText).toHaveBeenCalledTimes(3);
    expect(mockFetchAttachmentText.mock.calls.map((call) => call[1])).toEqual([
      'alpha.pdf',
      'beta.pdf',
      'gamma.pdf',
    ]);
    expect(mockUpsertIngestedAttachment).not.toHaveBeenCalled();
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: expect.stringContaining('BEGIN FILE ATTACHMENT: gamma.pdf'),
      }),
    );

    const ingestPayload = mockIngestEvent.mock.calls[0]?.[0] as { content?: string };
    expect(ingestPayload.content).toContain(
      'Processed 3 attachment(s) for this turn. Persistent attachment cache is unavailable in this channel.',
    );
    expect(ingestPayload.content).not.toContain('Skipped 1 attachment(s) due to per-message limit');
  });

  it('queues uploaded image attachments for durable recall in logged channels', async () => {
    mockUpsertIngestedAttachment.mockResolvedValueOnce({ id: 'attachment-row-image' });

    const message = createMockMessage({
      content: 'random chat with image',
      channelId: 'channel-images',
      attachments: {
        values: vi.fn(() => [
          {
            name: 'meme.png',
            url: 'https://cdn.discordapp.com/meme.png',
            contentType: 'image/png',
            size: 1234,
          },
        ]),
        first: vi.fn(() => null),
      },
    });

    await handleMessageCreate(message);

    expect(mockFetchAttachmentText).not.toHaveBeenCalled();
    expect(mockUpsertIngestedAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: message.id,
        filename: 'meme.png',
        extractor: 'vision',
        status: 'queued',
        extractedText: null,
      }),
    );
    expect(mockQueueImageAttachmentRecall).toHaveBeenCalledTimes(1);

    const ingestPayload = mockIngestEvent.mock.calls[0]?.[0] as { content?: string };
    expect(ingestPayload.content).toContain('Attachment cache processed 1 attachment(s); cached attachments: 1.');
    expect(ingestPayload.content).toContain('attachment:attachment-row-image');
    expect(mockGenerateChatReply).not.toHaveBeenCalled();
  });

  it('keeps cached image attachment references in runtime notes for invoked turns', async () => {
    mockUpsertIngestedAttachment.mockResolvedValueOnce({ id: 'attachment-row-image' });

    const message = createMockMessage({
      content: '<@123> what is this image?',
      channelId: 'channel-images',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      attachments: {
        values: vi.fn(() => [
          {
            name: 'scene.png',
            url: 'https://cdn.discordapp.com/scene.png',
            contentType: 'image/png',
            size: 2048,
          },
        ]),
        first: vi.fn(() => null),
      },
    });

    await handleMessageCreate(message);

    expect(mockQueueImageAttachmentRecall).toHaveBeenCalledTimes(1);
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: expect.stringContaining('Attachments were cached.'),
      }),
    );
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: expect.stringContaining('attachment:attachment-row-image'),
      }),
    );
  });

  it('queues embedding updates after attachment cache persistence', async () => {
    mockFetchAttachmentText.mockResolvedValueOnce({
      kind: 'ok',
      text: 'gamma body',
      extractor: 'tika',
      byteLength: 20,
      mimeType: 'text/plain',
    });
    mockUpsertIngestedAttachment.mockResolvedValueOnce({ id: 'attachment-row-1' });

    const message = createMockMessage({
      content: '<@123> index this',
      channelId: 'channel-files',
      mentions: {
        has: vi.fn((user: User) => user.id === '123'),
        users: new Map<string, User>(),
      },
      attachments: {
        values: vi.fn(() => [
          {
            name: 'gamma.txt',
            url: 'https://cdn.discordapp.com/gamma.txt',
            contentType: 'text/plain',
            size: 20,
          },
        ]),
        first: vi.fn(() => null),
      },
    });

    await handleMessageCreate(message);
    await flushMicrotasks();

    expect(mockUpsertIngestedAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: message.id,
        status: 'ok',
        extractedText: 'gamma body',
      }),
    );
    expect(mockDeleteAttachmentChunks).toHaveBeenCalledWith('attachment-row-1');
    expect(mockIngestAttachmentText).toHaveBeenCalledWith('attachment-row-1', 'gamma body');
  });
});
