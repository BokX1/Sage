import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CurrentTurnContext } from '@/features/agent-runtime/continuityContext';
import { updateProfileSummary, extractBalancedJson } from '../../../../src/features/memory/profileUpdater';

// Mock LLM Client
const mockChatFn = vi.fn();
vi.mock('@/platform/llm', () => ({
  getLLMClient: () => ({
    chat: mockChatFn,
  }),
  createLLMClient: () => ({
    chat: mockChatFn,
  }),
}));

vi.mock('@/platform/config/env', () => ({
  config: {
    AI_PROVIDER_PROFILE_AGENT_MODEL: 'test-profile-agent-model',
    TIMEOUT_MEMORY_MS: 600000,
  },
}));

const mockGetRecentMessages = vi.hoisted(() => vi.fn().mockReturnValue([]));
vi.mock('@/features/awareness/channelRingBuffer', () => ({
  getRecentMessages: mockGetRecentMessages,
}));

type ChatMessage = {
  role: string;
  content: string;
};

function makeCurrentTurn(overrides: Partial<CurrentTurnContext> = {}): CurrentTurnContext {
  return {
    invokerUserId: 'U1',
    invokerDisplayName: 'User',
    messageId: 'msg-1',
    guildId: 'G1',
    channelId: 'C1',
    invokedBy: 'mention',
    mentionedUserIds: [],
    isDirectReply: false,
    replyTargetMessageId: null,
    replyTargetAuthorId: null,
    botUserId: 'B1',
    ...overrides,
  };
}

describe('ProfileUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatFn.mockReset();
    mockGetRecentMessages.mockReset().mockReturnValue([]);
  });

  describe('updateProfileSummary - jsonrepair Pipeline', () => {
    it('should complete pipeline: Analyst outputs JSON summary', async () => {
      // Step 1: Analyst outputs the updated summary as JSON
      mockChatFn.mockResolvedValueOnce({
        text: '{"summary": "<preferences>Loves cats</preferences>\\n<active_focus>Enthusiastic about felines</active_focus>\\n<background>Enjoys cozy spaces</background>"}',
      });

      const result = await updateProfileSummary({
        previousSummary: null,
        userMessage: 'I love cats!',
        assistantReply: 'Cats are wonderful!',
        currentTurn: makeCurrentTurn(),
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      expect(result).toBe('<preferences>Loves cats</preferences>\n<active_focus>Enthusiastic about felines</active_focus>\n<background>Enjoys cozy spaces</background>');
      expect(mockChatFn).toHaveBeenCalledTimes(1);

      // Verify Step 1 (Analyst) keeps the JSON-only prompt contract
      const analystCall = mockChatFn.mock.calls[0][0];
      expect(analystCall.temperature).toBe(0.3);
      const analystSystemPrompt = analystCall.messages[0]?.content ?? '';
      expect(analystSystemPrompt).toContain('stable interaction preferences');
      expect(analystSystemPrompt).not.toContain('standing user rules');
      expect(analystSystemPrompt).toContain('omit the detail rather than inferring it');
    });

    it('should preserve previous summary when adding new facts', async () => {
      // Analyst merges previous + new facts as JSON
      mockChatFn.mockResolvedValueOnce({
        text: '{"summary": "<preferences>Prefers detailed travel tips</preferences>\\n<active_focus>Lives in Paris and loves cats</active_focus>\\n<background>Enjoys city guides</background>"}',
      });

      const result = await updateProfileSummary({
        previousSummary: '<preferences>Prefers detailed travel tips</preferences>\n<active_focus>Lives in Paris</active_focus>\n<background>Enjoys city guides</background>',
        userMessage: 'I love cats!',
        assistantReply: 'Cats are wonderful!',
        currentTurn: makeCurrentTurn(),
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      expect(result).toBe('<preferences>Prefers detailed travel tips</preferences>\n<active_focus>Lives in Paris and loves cats</active_focus>\n<background>Enjoys city guides</background>');
    });



    it('should preserve previous summary if analyst returns empty', async () => {
      // Analyst returns empty
      mockChatFn.mockResolvedValueOnce({
        text: '',
      });

      const result = await updateProfileSummary({
        previousSummary: '<preferences>Prefers concise answers</preferences>\n<active_focus>Lives in Paris</active_focus>\n<background>Travels often</background>',
        userMessage: 'Hi',
        assistantReply: 'Hello!',
        currentTurn: makeCurrentTurn(),
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      // Should preserve existing memory
      expect(result).toBe('<preferences>Prefers concise answers</preferences>\n<active_focus>Lives in Paris</active_focus>\n<background>Travels often</background>');
      expect(mockChatFn).toHaveBeenCalledTimes(1);
    });

    it('should return null if analyst throws error and no previous summary', async () => {
      // Analyst throws error
      mockChatFn.mockRejectedValueOnce(new Error('LLM Error'));

      const result = await updateProfileSummary({
        previousSummary: null,
        userMessage: 'Hi',
        assistantReply: 'Hello',
        currentTurn: makeCurrentTurn(),
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      expect(result).toBeNull();
    });

    it('should preserve previous summary if JSON parsing fails to yield a string', async () => {
      // Analyst outputs a JSON structure missing the "summary" string
      mockChatFn.mockResolvedValueOnce({
        text: '{"malformed": true}',
      });

      const result = await updateProfileSummary({
        previousSummary: '<preferences>Prefers concise answers</preferences>\n<active_focus>Lives in Paris</active_focus>\n<background>Travels often</background>',
        userMessage: 'Hi',
        assistantReply: 'Hi',
        currentTurn: makeCurrentTurn(),
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      // Should preserve existing memory instead of returning null
      expect(result).toBe('<preferences>Prefers concise answers</preferences>\n<active_focus>Lives in Paris</active_focus>\n<background>Travels often</background>');
      expect(mockChatFn).toHaveBeenCalledTimes(1);
    });

    it('should deduplicate user and assistant messages if they appear trailing in history', async () => {
      // Setup history mock to include the very messages we're updating for
      mockGetRecentMessages.mockReturnValueOnce([
        {
          messageId: 'msg-history-1',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U1',
          authorDisplayName: 'User',
          authorIsBot: false,
          content: 'older context',
          timestamp: new Date(),
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
        {
          messageId: 'msg-history-2',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U1',
          authorDisplayName: 'User',
          authorIsBot: false,
          content: 'What about dogs?',
          timestamp: new Date(),
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
        {
          messageId: 'msg-history-3',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'B1',
          authorDisplayName: 'Bot',
          authorIsBot: true,
          content: 'Dogs are cool.',
          timestamp: new Date(),
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
      ]);

      mockChatFn.mockResolvedValueOnce({
        text: '{"summary": "<preferences>Likes dogs</preferences>\\n<active_focus>Exploring pet care</active_focus>\\n<background>Owns a rescue dog</background>"}',
      });

      const result = await updateProfileSummary({
        previousSummary: '<preferences>Likes cats</preferences>\n<active_focus>Comparing pets</active_focus>\n<background>Lives with animals</background>',
        userMessage: 'What about dogs?', // exact match
        assistantReply: 'Dogs are cool.', // exact match
        currentTurn: makeCurrentTurn(),
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      expect(result).toBe('<preferences>Likes dogs</preferences>\n<active_focus>Exploring pet care</active_focus>\n<background>Owns a rescue dog</background>');
      expect(mockGetRecentMessages).toHaveBeenCalledTimes(1);

      const analystCall = mockChatFn.mock.calls[0][0];
      const messages = analystCall.messages as ChatMessage[];
      const userPrompt = messages.find((message) => message.role === 'user')?.content ?? '';

      // The deduping should pop BOTH trailing messages if they match
      expect(userPrompt).toContain('older context');
      // "What about dogs?" and "Dogs are cool." should NOT appear in the Recent Conversation History block
      // (They still appear in the Latest Interaction block, but we want to confirm they aren't repeated)
      const recentHistoryBlock = userPrompt.split('Latest Interaction (Focus):')[0];
      expect(recentHistoryBlock).not.toContain('What about dogs?');
      expect(recentHistoryBlock).not.toContain('Dogs are cool.');
    });

    it('keeps the invoking user focused history even when another user has matching text', async () => {
      mockGetRecentMessages.mockReturnValueOnce([
        {
          messageId: 'msg-history-1',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U1',
          authorDisplayName: 'User',
          authorIsBot: false,
          content: 'older context',
          timestamp: new Date(),
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
        {
          messageId: 'msg-history-2',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U2',
          authorDisplayName: 'Other User',
          authorIsBot: false,
          content: 'same text',
          timestamp: new Date(),
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
      ]);

      mockChatFn.mockResolvedValueOnce({
        text: '{"summary": "<preferences>Keeps context safely</preferences>\\n<active_focus>Reviewing current thread</active_focus>\\n<background>Values attribution</background>"}',
      });

      const result = await updateProfileSummary({
        previousSummary: '<preferences>Existing preference</preferences>\n<active_focus>Existing focus</active_focus>\n<background>Existing background</background>',
        userMessage: 'new user message',
        assistantReply: 'same text',
        currentTurn: makeCurrentTurn(),
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      expect(result).toBe('<preferences>Keeps context safely</preferences>\n<active_focus>Reviewing current thread</active_focus>\n<background>Values attribution</background>');

      const analystCall = mockChatFn.mock.calls[0][0];
      const messages = analystCall.messages as ChatMessage[];
      const userPrompt = messages.find((message) => message.role === 'user')?.content ?? '';
      const recentHistoryBlock = userPrompt.split('Latest Interaction (Focus):')[0];
      expect(recentHistoryBlock).toContain('older context');
      expect(recentHistoryBlock).not.toContain('same text');
    });

    it('keeps reply-turn focused history scoped to the reply chain instead of unrelated invoker history', async () => {
      mockGetRecentMessages.mockReturnValueOnce([
        {
          messageId: 'msg-history-u1',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U1',
          authorDisplayName: 'User',
          authorIsBot: false,
          content: 'my unrelated earlier release question',
          timestamp: new Date(),
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
        {
          messageId: 'msg-history-parent',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U2',
          authorDisplayName: 'Other User',
          authorIsBot: false,
          content: 'can someone check the deployment logs',
          timestamp: new Date(),
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
        {
          messageId: 'msg-history-target',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U2',
          authorDisplayName: 'Other User',
          authorIsBot: false,
          content: 'bluegaming context from user two',
          timestamp: new Date(),
          replyToMessageId: 'msg-history-parent',
          mentionsUserIds: [],
          mentionsBot: false,
        },
        {
          messageId: 'msg-history-chain',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U1',
          authorDisplayName: 'User',
          authorIsBot: false,
          content: 'I can check that next',
          timestamp: new Date(),
          replyToMessageId: 'msg-history-target',
          mentionsUserIds: [],
          mentionsBot: false,
        },
      ]);

      mockChatFn.mockResolvedValueOnce({
        text: '{"summary": "<preferences>Keeps reply context scoped</preferences>\\n<active_focus>Investigating the replied-to thread</active_focus>\\n<background>Values attribution</background>"}',
      });

      const result = await updateProfileSummary({
        previousSummary: '<preferences>Existing preference</preferences>\n<active_focus>Existing focus</active_focus>\n<background>Existing background</background>',
        userMessage: 'let me check it',
        assistantReply: 'I can do that.',
        currentTurn: makeCurrentTurn({
          invokedBy: 'reply',
          isDirectReply: true,
          replyTargetMessageId: 'msg-history-target',
          replyTargetAuthorId: 'U2',
        }),
        replyTarget: {
          messageId: 'msg-history-target',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U2',
          authorDisplayName: 'Other User',
          authorIsBot: false,
          replyToMessageId: 'msg-history-parent',
          mentionedUserIds: [],
          content: 'bluegaming context from user two',
        },
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      expect(result).toBe('<preferences>Keeps reply context scoped</preferences>\n<active_focus>Investigating the replied-to thread</active_focus>\n<background>Values attribution</background>');

      const analystCall = mockChatFn.mock.calls[0][0];
      const messages = analystCall.messages as ChatMessage[];
      const userPrompt = messages.find((message) => message.role === 'user')?.content ?? '';
      const recentHistoryBlock = userPrompt.split('Latest Interaction (Focus):')[0];
      expect(recentHistoryBlock).toContain('can someone check the deployment logs');
      expect(recentHistoryBlock).toContain('I can check that next');
      expect(recentHistoryBlock).not.toContain('my unrelated earlier release question');
    });

    it('keeps direct-reply mention history scoped to the reply chain instead of unrelated invoker history', async () => {
      mockGetRecentMessages.mockReturnValueOnce([
        {
          messageId: 'msg-history-u1-mention',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U1',
          authorDisplayName: 'User',
          authorIsBot: false,
          content: 'my unrelated earlier release question',
          timestamp: new Date(),
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
        {
          messageId: 'msg-history-parent-mention',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U2',
          authorDisplayName: 'Other User',
          authorIsBot: false,
          content: 'can someone check the deployment logs',
          timestamp: new Date(),
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
        {
          messageId: 'msg-history-target-mention',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U2',
          authorDisplayName: 'Other User',
          authorIsBot: false,
          content: 'bluegaming context from user two',
          timestamp: new Date(),
          replyToMessageId: 'msg-history-parent-mention',
          mentionsUserIds: [],
          mentionsBot: false,
        },
        {
          messageId: 'msg-history-chain-mention',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U1',
          authorDisplayName: 'User',
          authorIsBot: false,
          content: 'I can check that next',
          timestamp: new Date(),
          replyToMessageId: 'msg-history-target-mention',
          mentionsUserIds: [],
          mentionsBot: false,
        },
      ]);

      mockChatFn.mockResolvedValueOnce({
        text: '{"summary": "<preferences>Keeps reply context scoped</preferences>\\n<active_focus>Investigating the replied-to thread</active_focus>\\n<background>Values attribution</background>"}',
      });

      await updateProfileSummary({
        previousSummary: '<preferences>Existing preference</preferences>\n<active_focus>Existing focus</active_focus>\n<background>Existing background</background>',
        userMessage: '@sage let me check it',
        assistantReply: 'I can do that.',
        currentTurn: makeCurrentTurn({
          invokedBy: 'mention',
          mentionedUserIds: ['B1'],
          isDirectReply: true,
          replyTargetMessageId: 'msg-history-target-mention',
          replyTargetAuthorId: 'U2',
        }),
        replyTarget: {
          messageId: 'msg-history-target-mention',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U2',
          authorDisplayName: 'Other User',
          authorIsBot: false,
          replyToMessageId: 'msg-history-parent-mention',
          mentionedUserIds: [],
          content: 'bluegaming context from user two',
        },
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      const analystCall = mockChatFn.mock.calls[0][0];
      const messages = analystCall.messages as ChatMessage[];
      const userPrompt = messages.find((message) => message.role === 'user')?.content ?? '';
      const recentHistoryBlock = userPrompt.split('Latest Interaction (Focus):')[0];
      expect(recentHistoryBlock).toContain('can someone check the deployment logs');
      expect(recentHistoryBlock).toContain('I can check that next');
      expect(recentHistoryBlock).not.toContain('my unrelated earlier release question');
    });

    it('normalizes legacy directives into preferences', async () => {
      mockChatFn.mockResolvedValueOnce({
        text: '{"summary": "<directives>Prefers concise answers</directives>\\n<active_focus>Refining prompts</active_focus>\\n<background>Maintains Sage</background>"}',
      });

      const result = await updateProfileSummary({
        previousSummary: null,
        userMessage: 'Keep it brief',
        assistantReply: 'Will do.',
        currentTurn: makeCurrentTurn(),
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      expect(result).toBe('<preferences>Prefers concise answers</preferences>\n<active_focus>Refining prompts</active_focus>\n<background>Maintains Sage</background>');
    });

    it('preserves the previous summary when required profile sections are missing', async () => {
      mockChatFn.mockResolvedValueOnce({
        text: '{"summary": "<preferences>Prefers concise answers</preferences>\\n<background>Maintains Sage</background>"}',
      });

      const previousSummary = '<preferences>Prefers concise answers</preferences>\n<active_focus>Refining prompts</active_focus>\n<background>Maintains Sage</background>';
      const result = await updateProfileSummary({
        previousSummary,
        userMessage: 'Keep it brief',
        assistantReply: 'Will do.',
        currentTurn: makeCurrentTurn(),
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      expect(result).toBe(previousSummary);
    });

    it('includes reply target context as supporting evidence in the analyst prompt', async () => {
      mockChatFn.mockResolvedValueOnce({
        text: '{"summary": "<preferences>Prefers concise answers</preferences>\\n<active_focus>Refining prompts</active_focus>\\n<background>Maintains Sage</background>"}',
      });

      await updateProfileSummary({
        previousSummary: null,
        userMessage: 'Keep it brief',
        assistantReply: 'Will do.',
        currentTurn: makeCurrentTurn({
          invokedBy: 'reply',
          isDirectReply: true,
          replyTargetMessageId: 'reply-msg-1',
          replyTargetAuthorId: 'U2',
        }),
        replyTarget: {
          messageId: 'reply-msg-1',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U2',
          authorDisplayName: 'Other User',
          authorIsBot: false,
          replyToMessageId: null,
          mentionedUserIds: [],
          content: 'Earlier they asked for terse code comments.',
        },
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      const analystCall = mockChatFn.mock.calls[0][0];
      const messages = analystCall.messages as ChatMessage[];
      const userPrompt = messages.find((message) => message.role === 'user')?.content ?? '';
      expect(userPrompt).toContain('Supporting Reply Target Context:');
      expect(userPrompt).toContain('Earlier they asked for terse code comments.');
      expect(userPrompt).toContain('supporting evidence only');
      const analystSystemPrompt = messages.find((message) => message.role === 'system')?.content ?? '';
      expect(analystSystemPrompt).toContain('best-effort personalization that may become stale between updates');
      expect(analystSystemPrompt).toContain('Current user input always outranks stored profile content.');
      expect(analystSystemPrompt).toContain('Do not turn one-off requests into stable preferences unless they appear durable or repeated.');
      expect(analystSystemPrompt).toContain('prioritize the invoking user\'s own turns and direct reply-target evidence over unrelated messages from other people');
      expect(analystSystemPrompt).toContain('omit the detail rather than inferring it');
    });

    it('keeps unrelated external bot chatter out of focused profile history', async () => {
      mockGetRecentMessages.mockReturnValueOnce([
        {
          messageId: 'msg-history-1',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'U1',
          authorDisplayName: 'User',
          authorIsBot: false,
          content: 'still tuning the deployment copy',
          timestamp: new Date(),
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
        {
          messageId: 'msg-history-2',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'deploy-bot',
          authorDisplayName: 'DeployBot',
          authorIsBot: true,
          content: 'Deployment completed successfully',
          timestamp: new Date(),
          replyToMessageId: undefined,
          mentionsUserIds: [],
          mentionsBot: false,
        },
      ]);

      mockChatFn.mockResolvedValueOnce({
        text: '{"summary": "<preferences>Values clean attribution</preferences>\\n<active_focus>Reviewing deployment messaging</active_focus>\\n<background>Maintains Sage</background>"}',
      });

      const result = await updateProfileSummary({
        previousSummary: null,
        userMessage: 'make the release note shorter',
        assistantReply: 'I can shorten it.',
        currentTurn: makeCurrentTurn(),
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      expect(result).toBe('<preferences>Values clean attribution</preferences>\n<active_focus>Reviewing deployment messaging</active_focus>\n<background>Maintains Sage</background>');

      const analystCall = mockChatFn.mock.calls[0][0];
      const messages = analystCall.messages as ChatMessage[];
      const userPrompt = messages.find((message) => message.role === 'user')?.content ?? '';
      const recentHistoryBlock = userPrompt.split('Supporting Reply Target Context:')[0];
      expect(recentHistoryBlock).toContain('still tuning the deployment copy');
      expect(recentHistoryBlock).not.toContain('Deployment completed successfully');
    });

    it('keeps bot reply-target context available when the human is explicitly replying to that bot', async () => {
      mockChatFn.mockResolvedValueOnce({
        text: '{"summary": "<preferences>Prefers concise status recaps</preferences>\\n<active_focus>Reviewing bot-reported warnings</active_focus>\\n<background>Maintains Sage</background>"}',
      });

      await updateProfileSummary({
        previousSummary: null,
        userMessage: 'what are the warnings?',
        assistantReply: 'The scan reported two warnings.',
        currentTurn: makeCurrentTurn({
          invokedBy: 'reply',
          isDirectReply: true,
          replyTargetMessageId: 'reply-msg-bot',
          replyTargetAuthorId: 'helper-bot',
        }),
        replyTarget: {
          messageId: 'reply-msg-bot',
          guildId: 'G1',
          channelId: 'C1',
          authorId: 'helper-bot',
          authorDisplayName: 'HelperBot',
          authorIsBot: true,
          replyToMessageId: null,
          mentionedUserIds: [],
          content: 'Scan finished: 2 warnings found.',
        },
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      const analystCall = mockChatFn.mock.calls[0][0];
      const messages = analystCall.messages as ChatMessage[];
      const userPrompt = messages.find((message) => message.role === 'user')?.content ?? '';
      const analystSystemPrompt = messages.find((message) => message.role === 'system')?.content ?? '';
      expect(userPrompt).toContain('author_is_bot: true');
      expect(userPrompt).toContain('Scan finished: 2 warnings found.');
      expect(analystSystemPrompt).toContain(
        'Treat bot-authored messages as room events/context, not as the invoking user, unless the current human turn directly replies to or explicitly centers that bot-authored message.',
      );
    });
  });

  describe('extractBalancedJson', () => {
    it('should extract JSON from code blocks', () => {
      const input = 'Here you go:\n```json\n{"summary": "Likes cats"}\n```';
      const result = extractBalancedJson(input);
      expect(result).toBe('{"summary": "Likes cats"}');
    });

    it('should extract JSON from code blocks without json marker', () => {
      const input = 'Result:\n```\n{"summary": "test"}\n```';
      const result = extractBalancedJson(input);
      expect(result).toBe('{"summary": "test"}');
    });

    it('should extract first object when text surrounds JSON', () => {
      const input = 'Here is the result: {"summary": "test"} hope that helps!';
      const result = extractBalancedJson(input);
      expect(result).toBe('{"summary": "test"}');
    });

    it('should correctly handle braces inside strings', () => {
      const input = '{"summary": "User said {hello} and {world}"}';
      const result = extractBalancedJson(input);
      expect(result).toBe('{"summary": "User said {hello} and {world}"}');
    });

    it('should handle escaped quotes in strings', () => {
      const input = '{"summary": "User said \\"hello\\" friend"}';
      const result = extractBalancedJson(input);
      expect(result).toBe('{"summary": "User said \\"hello\\" friend"}');
    });

    it('should handle nested objects', () => {
      const input = 'prefix {"outer": {"inner": "value"}} suffix';
      const result = extractBalancedJson(input);
      expect(result).toBe('{"outer": {"inner": "value"}}');
    });

    it('should return null for no JSON', () => {
      const input = 'This is just plain text with no JSON';
      const result = extractBalancedJson(input);
      expect(result).toBeNull();
    });

    it('should return null for incomplete JSON', () => {
      const input = 'Incomplete: {"summary": "test"';
      const result = extractBalancedJson(input);
      expect(result).toBeNull();
    });
  });
});
