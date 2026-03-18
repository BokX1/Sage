import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { CurrentTurnContext } from '@/features/agent-runtime/continuityContext';

const mockConfig = vi.hoisted(() => ({
  CONTEXT_TRANSCRIPT_MAX_MESSAGES: 6,
  CONTEXT_USER_MAX_TOKENS: 8_000,
  CONTEXT_MAX_INPUT_TOKENS: 16_000,
  CONTEXT_RESERVED_OUTPUT_TOKENS: 4_000,
  AUTOPILOT_MODE: 'manual',
  RAW_MESSAGE_TTL_DAYS: 3,
  RING_BUFFER_MAX_MESSAGES_PER_CHANNEL: 200,
  AI_PROVIDER_MAIN_AGENT_MODEL: 'test-main-agent-model',
  CHAT_MAX_OUTPUT_TOKENS: 800,
  AGENT_GRAPH_MAX_OUTPUT_TOKENS: 800,
  AGENT_GRAPH_GITHUB_GROUNDED_MODE: false,
  TIMEOUT_CHAT_MS: 1_000,
  AI_PROVIDER_API_KEY: 'test-key',
  SAGE_TRACE_DB_ENABLED: false,
  LANGSMITH_TRACING: false,
}));

vi.mock('@/platform/config/env', () => ({
  config: mockConfig,
}));

const mockGetGuildSagePersonaText = vi.hoisted(() => vi.fn());
const mockRunAgentGraphTurn = vi.hoisted(() => vi.fn());

vi.mock('@/features/agent-runtime/langgraph/runtime', () => ({
  runAgentGraphTurn: mockRunAgentGraphTurn,
  resumeAgentGraphTurn: vi.fn(),
}));

vi.mock('@/features/settings/guildChannelSettings', () => ({
  isLoggingEnabled: vi.fn(),
}));

vi.mock('@/features/settings/guildSettingsRepo', () => ({
  getGuildApiKey: vi.fn().mockResolvedValue('test-key'),
}));

vi.mock('@/features/settings/guildSagePersonaRepo', () => ({
  getGuildSagePersonaText: mockGetGuildSagePersonaText,
}));

vi.mock('@/features/agent-runtime/agent-trace-repo', () => ({
  upsertTraceStart: vi.fn().mockResolvedValue(undefined),
  updateTraceEnd: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/agent-runtime/toolIntegrations', () => ({
  clearGitHubFileLookupCacheForTrace: vi.fn(),
}));

import { appendMessage, clearChannel } from '@/features/awareness/channelRingBuffer';
import { runChatTurn } from '@/features/agent-runtime/agentRuntime';
import { isLoggingEnabled } from '@/features/settings/guildChannelSettings';

function makeCurrentTurn(overrides: Partial<CurrentTurnContext> = {}): CurrentTurnContext {
  return {
    invokerUserId: 'user-1',
    invokerDisplayName: 'User One',
    messageId: 'msg-current',
    guildId: 'guild-1',
    channelId: 'channel-1',
    invokedBy: 'mention',
    mentionedUserIds: [],
    isDirectReply: false,
    replyTargetMessageId: null,
    replyTargetAuthorId: null,
    botUserId: 'sage-bot',
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    messageId: 'msg-default',
    guildId: 'guild-1',
    channelId: 'channel-1',
    authorId: 'user-1',
    authorDisplayName: 'User One',
    authorIsBot: false,
    timestamp: new Date('2026-03-11T00:00:00.000Z'),
    content: 'default content',
    replyToMessageId: undefined,
    mentionsUserIds: [],
    mentionsBot: false,
    ...overrides,
  };
}

function getPromptCall() {
  return mockRunAgentGraphTurn.mock.calls[0]?.[0] as {
    messages: BaseMessage[];
  };
}

function getSystemMessageContent(): string {
  const content = getPromptCall().messages.find((message) => SystemMessage.isInstance(message))?.content;
  if (typeof content !== 'string') {
    throw new Error('Expected system message content to be a string');
  }
  return content;
}

function getUserMessageContent(): string {
  const content = getPromptCall().messages.find((message) => HumanMessage.isInstance(message))?.content;
  if (content === undefined) {
    throw new Error('Expected user message content to be present');
  }
  if (typeof content === 'string') {
    return content;
  }
  return content
    .map((part) => {
      if ('type' in part && part.type === 'text') {
        return typeof part.text === 'string' ? part.text : '';
      }
      if ('type' in part && part.type === 'image_url') {
        return '[image]';
      }
      return '';
    })
    .join('');
}

function extractTagBlock(content: string, tagName: string): string | null {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  const start = content.lastIndexOf(openTag);
  if (start === -1) {
    return null;
  }
  const end = content.indexOf(closeTag, start);
  if (end === -1) {
    return null;
  }
  return content.slice(start, end + closeTag.length);
}

describe('transcript injection', { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-13T00:00:00.000Z'));
    clearChannel({ guildId: 'guild-1', channelId: 'channel-1' });
    mockRunAgentGraphTurn.mockClear();
    mockRunAgentGraphTurn.mockResolvedValue({
      replyText: 'ok',
      toolResults: [],
      files: [],
      roundsCompleted: 0,
      completedWindows: 0,
      totalRoundsCompleted: 0,
      deduplicatedCallCount: 0,
      guardrailBlockedCallCount: 0,
      roundEvents: [],
      finalization: {
        attempted: false,
        succeeded: true,
        completedAt: new Date('2026-03-13T00:00:00.000Z').toISOString(),
        stopReason: 'verified_closeout',
        completionKind: 'final_answer',
        deliveryDisposition: 'chat_reply',
        protocolRepairCount: 0,
        toolDeliveredFinal: false,
      },
      completionKind: 'final_answer',
      stopReason: 'verified_closeout',
      deliveryDisposition: 'chat_reply',
      protocolRepairCount: 0,
      protocolRepairInstruction: null,
      toolDeliveredFinal: false,
      contextFrame: {
        objective: 'Finish the current user request cleanly.',
        verifiedFacts: [],
        completedActions: [],
        openQuestions: [],
        pendingApprovals: [],
        deliveryState: 'none',
        nextAction: 'Decide the next best step.',
      },
      graphStatus: 'completed',
      pendingInterrupt: null,
      interruptResolution: null,
      langSmithRunId: null,
      langSmithTraceId: null,
    });
    mockGetGuildSagePersonaText.mockResolvedValue(null);
    vi.mocked(isLoggingEnabled).mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('includes ambient transcript and focused continuity when logging is enabled', async () => {
    appendMessage(
      makeMessage({
        messageId: 'msg-history-1',
        content: 'Earlier context from the same user',
      }),
    );
    appendMessage(
      makeMessage({
        messageId: 'msg-history-2',
        authorId: 'user-2',
        authorDisplayName: 'User Two',
        content: 'Parallel chatter from another user',
      }),
    );
    appendMessage(
      makeMessage({
        messageId: 'msg-history-3',
        authorId: 'deploy-bot',
        authorDisplayName: 'DeployBot',
        authorIsBot: true,
        content: 'Deployment completed successfully',
      }),
    );

    await runChatTurn({
      traceId: 'trace-1',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-current',
      userText: 'Invoke',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn(),
    });

    const systemContent = getSystemMessageContent();
    const userContent = getUserMessageContent();
    const focusedContinuity = extractTagBlock(userContent, 'focused_continuity');
    const recentTranscript = extractTagBlock(userContent, 'recent_transcript');

    expect(systemContent).not.toContain('<tool_usage>');
    expect(systemContent).not.toContain('<untrusted_recent_transcript>');
    expect(focusedContinuity).toContain('Focused continuity window');
    expect(focusedContinuity).toContain('Earlier context from the same user');
    expect(focusedContinuity).not.toContain('Parallel chatter from another user');
    expect(focusedContinuity).not.toContain('Deployment completed successfully');
    expect(recentTranscript).toContain('Ambient room transcript');
    expect(recentTranscript).toContain('Earlier context from the same user');
    expect(recentTranscript).toContain('Parallel chatter from another user');
    expect(recentTranscript).toContain('Deployment completed successfully');
    expect(recentTranscript).toContain('speaker:self');
    expect(recentTranscript).toContain('speaker:human');
    expect(recentTranscript).toContain('speaker:external_bot');
  });

  it('skips transcript blocks when logging is disabled', async () => {
    vi.mocked(isLoggingEnabled).mockReturnValue(false);
    appendMessage(
      makeMessage({
        messageId: 'msg-history-1',
        authorId: 'user-2',
        authorDisplayName: 'User Two',
        content: 'No log',
      }),
    );

    await runChatTurn({
      traceId: 'trace-2',
      userId: 'user-2',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-current-2',
      userText: 'Invoke',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        invokerUserId: 'user-2',
        invokerDisplayName: 'User Two',
        messageId: 'msg-current-2',
      }),
    });

    const systemContent = getSystemMessageContent();
    const userContent = getUserMessageContent();
    expect(extractTagBlock(systemContent, 'recent_transcript')).toBeNull();
    expect(extractTagBlock(systemContent, 'focused_continuity')).toBeNull();
    expect(extractTagBlock(userContent, 'recent_transcript')).toBeNull();
    expect(extractTagBlock(userContent, 'focused_continuity')).toBeNull();
  });

  it('keeps a reply turn anchored to the reply target instead of unrelated room chatter', async () => {
    appendMessage(
      makeMessage({
        messageId: 'msg-heiryn',
        authorId: 'user-2',
        authorDisplayName: 'User Two',
        content: 'does heiryn have tools to update its own memory?',
      }),
    );
    appendMessage(
      makeMessage({
        messageId: 'msg-same-speaker',
        content: 'once approval lands we can test the new response',
      }),
    );
    appendMessage(
      makeMessage({
        messageId: 'msg-approval',
        authorId: 'sage-bot',
        authorDisplayName: 'Sage',
        authorIsBot: true,
        content: 'The approval card was accepted. Response behavior updated.',
      }),
    );
    appendMessage(
      makeMessage({
        messageId: 'msg-reply-neighbor',
        content: 'waiting for the approval result',
        replyToMessageId: 'msg-approval',
      }),
    );

    await runChatTurn({
      traceId: 'trace-3',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-current-3',
      userText: "alright let's see",
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        messageId: 'msg-current-3',
        invokedBy: 'reply',
        isDirectReply: true,
        replyTargetMessageId: 'msg-approval',
        replyTargetAuthorId: 'sage-bot',
      }),
      replyTarget: {
        messageId: 'msg-approval',
        guildId: 'guild-1',
        channelId: 'channel-1',
        authorId: 'sage-bot',
        authorDisplayName: 'Sage',
        authorIsBot: true,
        replyToMessageId: null,
        mentionedUserIds: [],
        content: 'The approval card was accepted. Response behavior updated.',
      },
    });

    const systemContent = getSystemMessageContent();
    const userContent = getUserMessageContent();
    const currentTurnBlock = extractTagBlock(systemContent, 'current_turn');
    const focusedContinuity = extractTagBlock(userContent, 'focused_continuity');
    const recentTranscript = extractTagBlock(userContent, 'recent_transcript');

    expect(currentTurnBlock).toContain('invocation_kind: reply');
    expect(currentTurnBlock).toContain('continuity_policy: reply_target > same_speaker_recent > explicit_named_subject > ambient_room');
    expect(focusedContinuity).toContain('once approval lands we can test the new response');
    expect(focusedContinuity).toContain('waiting for the approval result');
    expect(focusedContinuity).not.toContain('does heiryn have tools to update its own memory?');
    expect(recentTranscript).toContain('does heiryn have tools to update its own memory?');
    expect(recentTranscript).not.toContain('The approval card was accepted. Response behavior updated.');
    expect(userContent).toContain('<untrusted_reply_target>');
    expect(userContent).toContain('The approval card was accepted. Response behavior updated.');
    expect(userContent).toContain('<untrusted_user_input>');
    expect(userContent).toContain("alright let's see");
  });

  it('keeps same-speaker continuity ahead of busy-room chatter', async () => {
    appendMessage(
      makeMessage({
        messageId: 'msg-u1-1',
        content: 'ship the approval card copy update',
      }),
    );
    appendMessage(
      makeMessage({
        messageId: 'msg-u2-1',
        authorId: 'user-2',
        authorDisplayName: 'User Two',
        content: 'who is up for valorant later',
      }),
    );
    appendMessage(
      makeMessage({
        messageId: 'msg-u1-2',
        content: 'make it shorter but keep the same tone',
      }),
    );
    appendMessage(
      makeMessage({
        messageId: 'msg-u3-1',
        authorId: 'user-3',
        authorDisplayName: 'User Three',
        content: 'show me the meme thread',
      }),
    );

    await runChatTurn({
      traceId: 'trace-4',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-current-4',
      userText: 'keep the same direction but terser',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        messageId: 'msg-current-4',
      }),
    });

    const userContent = getUserMessageContent();
    const focusedContinuity = extractTagBlock(userContent, 'focused_continuity');
    const recentTranscript = extractTagBlock(userContent, 'recent_transcript');

    expect(focusedContinuity).toContain('ship the approval card copy update');
    expect(focusedContinuity).toContain('make it shorter but keep the same tone');
    expect(focusedContinuity).not.toContain('who is up for valorant later');
    expect(focusedContinuity).not.toContain('show me the meme thread');
    expect(recentTranscript).toContain('who is up for valorant later');
    expect(recentTranscript).toContain('show me the meme thread');
  });

  it('keeps explicit-subject evidence in ambient room context for named-subject turns', async () => {
    appendMessage(
      makeMessage({
        messageId: 'msg-subject',
        authorId: 'user-2',
        authorDisplayName: 'User Two',
        content: 'does heiryn have tools to update its own memory?',
      }),
    );
    appendMessage(
      makeMessage({
        messageId: 'msg-noise',
        authorId: 'user-3',
        authorDisplayName: 'User Three',
        content: 'what game are we playing tonight',
      }),
    );

    await runChatTurn({
      traceId: 'trace-5',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-current-5',
      userText: 'Does Heiryn have tools to update its own memory?',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        messageId: 'msg-current-5',
      }),
    });

    const systemContent = getSystemMessageContent();
    const userContent = getUserMessageContent();
    const currentTurnBlock = extractTagBlock(systemContent, 'current_turn');
    const focusedContinuity = extractTagBlock(userContent, 'focused_continuity');
    const recentTranscript = extractTagBlock(userContent, 'recent_transcript');

    expect(currentTurnBlock).toContain('continuity_policy: current_user_input > same_speaker_recent > explicit_named_subject > ambient_room');
    expect(focusedContinuity).toBeNull();
    expect(recentTranscript).toContain('does heiryn have tools to update its own memory?');
    expect(userContent).toContain('Does Heiryn have tools to update its own memory?');
  });

  it('keeps external bot room events visible in ambient context for a later human follow-up', async () => {
    appendMessage(
      makeMessage({
        messageId: 'msg-human-1',
        content: 'queue the deployment after lunch',
      }),
    );
    appendMessage(
      makeMessage({
        messageId: 'msg-bot-1',
        authorId: 'deploy-bot',
        authorDisplayName: 'DeployBot',
        authorIsBot: true,
        content: 'Deployment completed successfully on shard blue.',
      }),
    );

    await runChatTurn({
      traceId: 'trace-5b',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-current-5b',
      userText: 'did that finish cleanly?',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        messageId: 'msg-current-5b',
      }),
    });

    const userContent = getUserMessageContent();
    const focusedContinuity = extractTagBlock(userContent, 'focused_continuity');
    const recentTranscript = extractTagBlock(userContent, 'recent_transcript');

    expect(focusedContinuity).toContain('queue the deployment after lunch');
    expect(focusedContinuity).not.toContain('Deployment completed successfully on shard blue.');
    expect(recentTranscript).toContain('Deployment completed successfully on shard blue.');
    expect(recentTranscript).toContain('speaker:external_bot');
  });

  it('accepts an external bot reply target as valid supporting continuity for a human turn', async () => {
    appendMessage(
      makeMessage({
        messageId: 'msg-helper-bot',
        authorId: 'helper-bot',
        authorDisplayName: 'HelperBot',
        authorIsBot: true,
        content: 'Scan finished: 2 warnings found.',
      }),
    );
    appendMessage(
      makeMessage({
        messageId: 'msg-helper-neighbor',
        authorId: 'user-2',
        authorDisplayName: 'User Two',
        content: 'which warnings?',
        replyToMessageId: 'msg-helper-bot',
      }),
    );

    await runChatTurn({
      traceId: 'trace-5c',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-current-5c',
      userText: 'can you summarize that for me?',
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        messageId: 'msg-current-5c',
        invokedBy: 'mention',
        isDirectReply: true,
        replyTargetMessageId: 'msg-helper-bot',
        replyTargetAuthorId: 'helper-bot',
      }),
      replyTarget: {
        messageId: 'msg-helper-bot',
        guildId: 'guild-1',
        channelId: 'channel-1',
        authorId: 'helper-bot',
        authorDisplayName: 'HelperBot',
        authorIsBot: true,
        replyToMessageId: null,
        mentionedUserIds: [],
        content: 'Scan finished: 2 warnings found.',
      },
    });

    const systemContent = getSystemMessageContent();
    const userContent = getUserMessageContent();
    const currentTurnBlock = extractTagBlock(systemContent, 'current_turn');
    const focusedContinuity = extractTagBlock(userContent, 'focused_continuity');

    expect(currentTurnBlock).not.toContain('rule:');
    expect(systemContent).toContain(
      'Bot-authored messages may be relevant room context, but they do not become the current requester unless the current human turn explicitly surfaces them as the direct reply target.',
    );
    expect(focusedContinuity).toContain('which warnings?');
    expect(userContent).toContain('author_is_bot: true');
    expect(userContent).toContain('Scan finished: 2 warnings found.');
  });

  it('does not invent focused continuity for short acknowledgements without linkage', async () => {
    appendMessage(
      makeMessage({
        messageId: 'msg-noise-1',
        authorId: 'user-2',
        authorDisplayName: 'User Two',
        content: 'unrelated build pipeline discussion',
      }),
    );
    appendMessage(
      makeMessage({
        messageId: 'msg-noise-2',
        authorId: 'user-3',
        authorDisplayName: 'User Three',
        content: 'separate gaming conversation',
      }),
    );

    await runChatTurn({
      traceId: 'trace-6',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: 'msg-current-6',
      userText: "alright let's see",
      userProfileSummary: null,
      currentTurn: makeCurrentTurn({
        messageId: 'msg-current-6',
      }),
    });

    const systemContent = getSystemMessageContent();
    const userContent = getUserMessageContent();
    const currentTurnBlock = extractTagBlock(systemContent, 'current_turn');
    const focusedContinuity = extractTagBlock(userContent, 'focused_continuity');
    const recentTranscript = extractTagBlock(userContent, 'recent_transcript');

    expect(currentTurnBlock).not.toContain('rule:');
    expect(systemContent).toContain('Pronouns or short acknowledgements like "it", "that", "alright", "let\'s see", or "do it" do not unlock broader room continuity by themselves.');
    expect(focusedContinuity).toBeNull();
    expect(recentTranscript).toContain('unrelated build pipeline discussion');
    expect(recentTranscript).toContain('separate gaming conversation');
  });
});
