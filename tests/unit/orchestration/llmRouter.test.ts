
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decideRoute } from '../../../src/core/orchestration/llmRouter';

// Mock the LLM client creation to ensure we can verify if it was called
const mockChat = vi.fn();
vi.mock('../../../src/core/llm', () => ({
    createLLMClient: () => ({
        chat: mockChat,
    }),
}));

describe('llmRouter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should bypass LLM and return qa route when hasAttachment is true', async () => {
        const result = await decideRoute({
            userText: 'Look at this code',
            invokedBy: 'mention',
            hasGuild: true,
            hasAttachment: true,
            apiKey: 'test-key',
        });

        expect(result.kind).toBe('qa');
        expect(result.reasoningText).toContain('File attachment detected');
        // Verify LLM was NOT called
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('should call LLM when hasAttachment is false', async () => {
        // Mock LLM response
        mockChat.mockResolvedValue({
            content: JSON.stringify({
                reasoning: 'Just a greeting',
                route: 'qa',
                temperature: 0.7,
            }),
        });

        const result = await decideRoute({
            userText: 'Hello there',
            invokedBy: 'mention',
            hasGuild: true,
            hasAttachment: false,
            apiKey: 'test-key',
        });

        expect(result.kind).toBe('qa');
        // Verify LLM WAS called
        expect(mockChat).toHaveBeenCalled();
    });
});
