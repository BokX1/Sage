import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateProfileSummary, extractBalancedJson } from '../../../src/core/memory/profileUpdater';

// Mock LLM Client
const mockChatFn = vi.fn();
vi.mock('../../../src/core/llm', () => ({
  getLLMClient: () => ({
    chat: mockChatFn,
  }),
  createLLMClient: () => ({
    chat: mockChatFn,
  }),
}));

vi.mock('../../../src/config', () => ({
  config: {
    PROFILE_PROVIDER: 'pollinations',
    PROFILE_CHAT_MODEL: 'deepseek',
    TIMEOUT_MEMORY_MS: 600000,
  },
}));

const mockGetRecentMessages = vi.hoisted(() => vi.fn().mockReturnValue([]));
vi.mock('../../../src/core/awareness/channelRingBuffer', () => ({
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
        content: '{"summary": "Loves cats. Enthusiastic about felines."}',
      });

      const result = await updateProfileSummary({
        previousSummary: null,
        userMessage: 'I love cats!',
        assistantReply: 'Cats are wonderful!',
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      expect(result).toBe('Loves cats. Enthusiastic about felines.');
      expect(mockChatFn).toHaveBeenCalledTimes(1);

      // Verify Step 1 (Analyst) enforces JSON format
      const analystCall = mockChatFn.mock.calls[0][0];
      expect(analystCall.responseFormat).toBe('json_object');
      expect(analystCall.temperature).toBe(0.3);
    });

    it('should preserve previous summary when adding new facts', async () => {
      // Analyst merges previous + new facts as JSON
      mockChatFn.mockResolvedValueOnce({
        content: '{"summary": "Lives in Paris. Loves cats."}',
      });

      const result = await updateProfileSummary({
        previousSummary: 'Lives in Paris',
        userMessage: 'I love cats!',
        assistantReply: 'Cats are wonderful!',
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      expect(result).toBe('Lives in Paris. Loves cats.');
    });



    it('should preserve previous summary if analyst returns empty', async () => {
      // Analyst returns empty
      mockChatFn.mockResolvedValueOnce({
        content: '',
      });

      const result = await updateProfileSummary({
        previousSummary: 'Lives in Paris',
        userMessage: 'Hi',
        assistantReply: 'Hello!',
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      // Should preserve existing memory
      expect(result).toBe('Lives in Paris');
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
        content: '{"malformed": true}',
      });

      const result = await updateProfileSummary({
        previousSummary: 'Lives in Paris',
        userMessage: 'Hi',
        assistantReply: 'Hi',
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      // Should preserve existing memory instead of returning null
      expect(result).toBe('Lives in Paris');
      expect(mockChatFn).toHaveBeenCalledTimes(1);
    });

    it('should deduplicate user and assistant messages if they appear trailing in history', async () => {
      // Setup history mock to include the very messages we're updating for
      mockGetRecentMessages.mockReturnValueOnce([
        { authorId: 'U1', authorDisplayName: 'User', content: 'older context', timestamp: new Date() },
        { authorId: 'U1', authorDisplayName: 'User', content: 'What about dogs?', timestamp: new Date() },
        { authorId: 'B1', authorDisplayName: 'Bot', content: 'Dogs are cool.', timestamp: new Date() },
      ]);

      mockChatFn.mockResolvedValueOnce({
        content: '{"summary": "Likes dogs."}',
      });

      const result = await updateProfileSummary({
        previousSummary: 'Likes cats',
        userMessage: 'What about dogs?', // exact match
        assistantReply: 'Dogs are cool.', // exact match
        channelId: 'C1',
        guildId: 'G1',
        userId: 'U1',
      });

      expect(result).toBe('Likes dogs.');
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
