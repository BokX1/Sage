
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

    it('should match keywords and call LLM for image generation with attachment', async () => {
        // Mock LLM response for image generation
        mockChat.mockResolvedValue({
            content: JSON.stringify({
                reasoning: 'User wants to edit image',
                route: 'image_generate',
                temperature: 0.9,
            }),
        });

        const result = await decideRoute({
            userText: 'make this image cyberpunk',
            invokedBy: 'mention',
            hasGuild: true,
            hasAttachment: true,
            apiKey: 'test-key',
        });

        // LLM should be called because "make" is a keyword
        expect(mockChat).toHaveBeenCalled();
        expect(result.kind).toBe('image_generate');
    });

    it('should match keywords and call LLM for summarization with attachment', async () => {
        // Mock LLM response for summarization
        mockChat.mockResolvedValue({
            content: JSON.stringify({
                reasoning: 'User wants summary',
                route: 'summarize',
                temperature: 0.3,
            }),
        });

        const result = await decideRoute({
            userText: 'summarize this document',
            invokedBy: 'mention',
            hasGuild: true,
            hasAttachment: true,
            apiKey: 'test-key',
        });

        // LLM should be called because "summarize" is a keyword
        expect(mockChat).toHaveBeenCalled();
        expect(result.kind).toBe('summarize');
    });

    it('should bypass LLM and force QA for attachments without specific keywords', async () => {
        const result = await decideRoute({
            userText: 'Look at this code',
            invokedBy: 'mention',
            hasGuild: true,
            hasAttachment: true,
            apiKey: 'test-key',
        });

        expect(result.kind).toBe('qa');
        expect(result.reasoningText).toContain('no explicit expert keywords');
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

    it('should override voice_analytics hallucination to qa when keywords are missing', async () => {
        // Mock LLM returning voice_analytics for a non-voice query
        mockChat.mockResolvedValue({
            content: JSON.stringify({
                reasoning: 'I think this is about voice',
                route: 'voice_analytics',
                temperature: 0.3,
            }),
        });

        const result = await decideRoute({
            userText: 'Look at this massive upgrade',
            invokedBy: 'mention',
            hasGuild: true,
            hasAttachment: false,
            apiKey: 'test-key',
        });

        // Should be overridden to qa
        expect(result.kind).toBe('qa');
        expect(result.reasoningText).toContain('Guardrail');
    });

    it('should allow voice_analytics when keywords are present', async () => {
        // Mock LLM returning voice_analytics for a valid query
        mockChat.mockResolvedValue({
            content: JSON.stringify({
                reasoning: 'Valid voice query',
                route: 'voice_analytics',
                temperature: 0.3,
            }),
        });

        const result = await decideRoute({
            userText: 'who is in voice?',
            invokedBy: 'mention',
            hasGuild: true,
            hasAttachment: false,
            apiKey: 'test-key',
        });

        // Should NOT be overridden
        expect(result.kind).toBe('voice_analytics');
    });
});
