import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    PROFILE_PROVIDER: 'pollinations',
    PROFILE_CHAT_MODEL: 'deepseek',
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
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      expect(result).toBe('<preferences>Loves cats</preferences>\n<active_focus>Enthusiastic about felines</active_focus>\n<background>Enjoys cozy spaces</background>');
      expect(mockChatFn).toHaveBeenCalledTimes(1);

      // Verify Step 1 (Analyst) enforces JSON format
      const analystCall = mockChatFn.mock.calls[0][0];
      expect(analystCall.responseFormat).toBe('json_object');
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
        { authorId: 'U1', authorDisplayName: 'User', authorIsBot: false, content: 'older context', timestamp: new Date() },
        { authorId: 'U1', authorDisplayName: 'User', authorIsBot: false, content: 'What about dogs?', timestamp: new Date() },
        { authorId: 'B1', authorDisplayName: 'Bot', authorIsBot: true, content: 'Dogs are cool.', timestamp: new Date() },
      ]);

      mockChatFn.mockResolvedValueOnce({
        text: '{"summary": "<preferences>Likes dogs</preferences>\\n<active_focus>Exploring pet care</active_focus>\\n<background>Owns a rescue dog</background>"}',
      });

      const result = await updateProfileSummary({
        previousSummary: '<preferences>Likes cats</preferences>\n<active_focus>Comparing pets</active_focus>\n<background>Lives with animals</background>',
        userMessage: 'What about dogs?', // exact match
        assistantReply: 'Dogs are cool.', // exact match
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

    it('does not drop trailing history lines when text matches but authors do not', async () => {
      mockGetRecentMessages.mockReturnValueOnce([
        { authorId: 'U1', authorDisplayName: 'User', authorIsBot: false, content: 'older context', timestamp: new Date() },
        { authorId: 'U2', authorDisplayName: 'Other User', authorIsBot: false, content: 'same text', timestamp: new Date() },
      ]);

      mockChatFn.mockResolvedValueOnce({
        text: '{"summary": "<preferences>Keeps context safely</preferences>\\n<active_focus>Reviewing current thread</active_focus>\\n<background>Values attribution</background>"}',
      });

      const result = await updateProfileSummary({
        previousSummary: '<preferences>Existing preference</preferences>\n<active_focus>Existing focus</active_focus>\n<background>Existing background</background>',
        userMessage: 'new user message',
        assistantReply: 'same text',
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
      expect(recentHistoryBlock).toContain('same text');
    });

    it('normalizes legacy directives into preferences', async () => {
      mockChatFn.mockResolvedValueOnce({
        text: '{"summary": "<directives>Prefers concise answers</directives>\\n<active_focus>Refining prompts</active_focus>\\n<background>Maintains Sage</background>"}',
      });

      const result = await updateProfileSummary({
        previousSummary: null,
        userMessage: 'Keep it brief',
        assistantReply: 'Will do.',
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
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      expect(result).toBe(previousSummary);
    });

    it('includes reply reference text as supporting evidence in the analyst prompt', async () => {
      mockChatFn.mockResolvedValueOnce({
        text: '{"summary": "<preferences>Prefers concise answers</preferences>\\n<active_focus>Refining prompts</active_focus>\\n<background>Maintains Sage</background>"}',
      });

      await updateProfileSummary({
        previousSummary: null,
        userMessage: 'Keep it brief',
        assistantReply: 'Will do.',
        replyReferenceText: 'Earlier they asked for terse code comments.',
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      const analystCall = mockChatFn.mock.calls[0][0];
      const messages = analystCall.messages as ChatMessage[];
      const userPrompt = messages.find((message) => message.role === 'user')?.content ?? '';
      expect(userPrompt).toContain('Supporting Reply/Reference Context:');
      expect(userPrompt).toContain('Earlier they asked for terse code comments.');
      expect(userPrompt).toContain('supporting evidence only');
      const analystSystemPrompt = messages.find((message) => message.role === 'system')?.content ?? '';
      expect(analystSystemPrompt).toContain('best-effort personalization that may become stale between updates');
      expect(analystSystemPrompt).toContain('Current user input always outranks stored profile content.');
      expect(analystSystemPrompt).toContain('Do not turn one-off requests into stable preferences unless they appear durable or repeated.');
      expect(analystSystemPrompt).toContain('omit the detail rather than inferring it');
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
