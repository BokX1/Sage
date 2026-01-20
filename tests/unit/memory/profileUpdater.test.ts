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

// Mock Config
vi.mock('../../../src/core/config/env', () => ({
  config: {
    llmProvider: 'pollinations',
    profileProvider: '',
    profilePollinationsModel: 'gemini',
  },
}));

vi.mock('../../../src/config', () => ({
  config: {
    FORMATTER_MODEL: 'qwen-coder',
  },
}));

describe('ProfileUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatFn.mockReset();
  });

  describe('updateProfileSummary - Two-Step Pipeline', () => {
    it('should complete two-step pipeline: Analyst outputs summary -> Formatter wraps in JSON', async () => {
      // Step 1: Analyst outputs the updated summary directly
      mockChatFn.mockResolvedValueOnce({
        content: 'Loves cats. Enthusiastic about felines.',
      });

      // Step 2: Formatter wraps in JSON
      mockChatFn.mockResolvedValueOnce({
        content: '{"summary": "Loves cats. Enthusiastic about felines."}',
      });

      const result = await updateProfileSummary({
        previousSummary: null,
        userMessage: 'I love cats!',
        assistantReply: 'Cats are wonderful!',
      });

      expect(result).toBe('Loves cats. Enthusiastic about felines.');
      expect(mockChatFn).toHaveBeenCalledTimes(2);

      // Verify Step 1 (Analyst) does NOT request JSON format
      const analystCall = mockChatFn.mock.calls[0][0];
      expect(analystCall.responseFormat).toBeUndefined();
      expect(analystCall.temperature).toBe(0.3);

      // Verify Step 2 (Formatter) DOES request JSON format
      const formatterCall = mockChatFn.mock.calls[1][0];
      expect(formatterCall.responseFormat).toBe('json_object');
      expect(formatterCall.temperature).toBe(0);
    });

    it('should preserve previous summary when adding new facts', async () => {
      // Analyst merges previous + new facts
      mockChatFn.mockResolvedValueOnce({
        content: 'Lives in Paris. Loves cats.',
      });

      // Formatter wraps in JSON
      mockChatFn.mockResolvedValueOnce({
        content: '{"summary": "Lives in Paris. Loves cats."}',
      });

      const result = await updateProfileSummary({
        previousSummary: 'Lives in Paris',
        userMessage: 'I love cats!',
        assistantReply: 'Cats are wonderful!',
      });

      expect(result).toBe('Lives in Paris. Loves cats.');
    });

    it('should retry formatter when initial JSON parsing fails', async () => {
      // Step 1: Analyst outputs summary
      mockChatFn.mockResolvedValueOnce({
        content: 'Likes dogs.',
      });

      // Step 2: Formatter fails first attempt (returns malformed text)
      mockChatFn.mockResolvedValueOnce({
        content: 'Woof',
      });

      // Step 3: Formatter retry succeeds
      mockChatFn.mockResolvedValueOnce({
        content: '{"summary": "Likes dogs."}',
      });

      const result = await updateProfileSummary({
        previousSummary: null,
        userMessage: 'I like dogs',
        assistantReply: 'Dogs are great!',
      });

      expect(result).toBe('Likes dogs.');
      expect(mockChatFn).toHaveBeenCalledTimes(3);
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
      });

      expect(result).toBeNull();
    });

    it('should preserve previous summary if formatter fails completely', async () => {
      // Analyst outputs summary
      mockChatFn.mockResolvedValueOnce({
        content: 'User likes something.',
      });

      // Formatter keeps failing
      mockChatFn.mockResolvedValue({ content: 'Meow again' });

      const result = await updateProfileSummary({
        previousSummary: 'Lives in Paris',
        userMessage: 'Hi',
        assistantReply: 'Hi',
      });

      // Should preserve existing memory instead of returning null
      expect(result).toBe('Lives in Paris');
      expect(mockChatFn).toHaveBeenCalledTimes(3);
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
