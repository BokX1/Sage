import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateProfileSummary } from '../../../src/core/memory/profileUpdater';
import { getLLMClient } from '../../../src/core/llm';

// Mock LLM Client
const mockChatFn = vi.fn();
vi.mock('../../../src/core/llm', () => ({
  getLLMClient: () => ({
    chat: mockChatFn,
  }),
}));

// Mock Config
vi.mock('../../../src/core/config/env', () => ({
  config: {
    llmProvider: 'pollinations',
    geminiModel: 'test-model',
  },
}));

describe('ProfileUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatFn.mockReset();
  });

  it('should retry when receiving invalid JSON ("Meow")', async () => {
    // 1. First call fails with text (JSON mode mismatch/hallucination)
    mockChatFn.mockResolvedValueOnce({
      content: 'Meow',
    });

    // 2. Second call (retry) succeeds with valid JSON
    mockChatFn.mockResolvedValueOnce({
      content: '{"summary": "Likes cats"}',
    });

    const result = await updateProfileSummary({
      previousSummary: null,
      userMessage: 'I love cats',
      assistantReply: 'Meow',
    });

    expect(result).toBe('Likes cats');
    expect(mockChatFn).toHaveBeenCalledTimes(2);

    // Verify first call asked for JSON object
    expect(mockChatFn.mock.calls[0][0].responseFormat).toEqual('json_object');

    // Verify second call (retry) disabled responseFormat (to avoid provider crash/limit) strict prompt
    const retryCall = mockChatFn.mock.calls[1][0];
    expect(retryCall.responseFormat).toBeUndefined();

    // Verify strict instruction was appended
    const lastMsg = retryCall.messages[retryCall.messages.length - 1];
    expect(lastMsg.content).toContain('IMPORTANT: Output ONLY valid JSON');
  });

  it('should return null if retry also fails', async () => {
    mockChatFn.mockResolvedValue({ content: 'Meow again' });

    const result = await updateProfileSummary({
      previousSummary: null,
      userMessage: 'Hi',
      assistantReply: 'Hi',
    });

    expect(result).toBeNull();
    expect(mockChatFn).toHaveBeenCalledTimes(2); // Initial + 1 Retry
  });
});
