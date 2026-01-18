import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../../src/core/agentRuntime/toolRegistry';
import { runToolCallLoop } from '../../../src/core/agentRuntime/toolCallLoop';
import { LLMClient, LLMRequest, LLMResponse } from '../../../src/core/llm/types';

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('toolCallLoop', () => {
    let registry: ToolRegistry;
    let mockClient: LLMClient;
    let mockChat: ReturnType<typeof vi.fn<[LLMRequest], Promise<LLMResponse>>>;

    const testCtx = {
        traceId: 'test-trace',
        userId: 'user-1',
        channelId: 'channel-1',
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup registry with test tools
        registry = new ToolRegistry();

        registry.register({
            name: 'get_time',
            description: 'Get the current time',
            schema: z.object({}),
            execute: async () => ({ time: '12:00 PM' }),
        });

        registry.register({
            name: 'add_numbers',
            description: 'Add two numbers',
            schema: z.object({ a: z.number(), b: z.number() }),
            execute: async (args) => ({ sum: args.a + args.b }),
        });

        // Setup mock LLM client
        mockChat = vi.fn<[LLMRequest], Promise<LLMResponse>>();
        mockClient = { chat: mockChat };
    });

    describe('tool_calls envelope handling', () => {
        it('should execute tools when response is a valid envelope', async () => {
            // First call returns tool_calls envelope
            mockChat.mockResolvedValueOnce({
                content: JSON.stringify({
                    type: 'tool_calls',
                    calls: [{ name: 'get_time', args: {} }],
                }),
            });

            // Second call returns final answer
            mockChat.mockResolvedValueOnce({
                content: 'The current time is 12:00 PM.',
            });

            const result = await runToolCallLoop({
                client: mockClient,
                messages: [{ role: 'user', content: 'What time is it?' }],
                registry,
                ctx: testCtx,
            });

            expect(result.toolsExecuted).toBe(true);
            expect(result.roundsCompleted).toBe(1);
            expect(result.toolResults).toHaveLength(1);
            expect(result.toolResults[0].name).toBe('get_time');
            expect(result.toolResults[0].success).toBe(true);
            expect(result.replyText).toBe('The current time is 12:00 PM.');
            expect(mockChat).toHaveBeenCalledTimes(2);
        });

        it('should handle envelope wrapped in code fences', async () => {
            mockChat.mockResolvedValueOnce({
                content: '```json\n{"type": "tool_calls", "calls": [{"name": "get_time", "args": {}}]}\n```',
            });

            mockChat.mockResolvedValueOnce({
                content: '12:00 PM',
            });

            const result = await runToolCallLoop({
                client: mockClient,
                messages: [{ role: 'user', content: 'time?' }],
                registry,
                ctx: testCtx,
            });

            expect(result.toolsExecuted).toBe(true);
            expect(result.toolResults).toHaveLength(1);
        });

        it('should treat non-envelope response as final answer', async () => {
            mockChat.mockResolvedValueOnce({
                content: 'Hello! How can I help you today?',
            });

            const result = await runToolCallLoop({
                client: mockClient,
                messages: [{ role: 'user', content: 'Hi' }],
                registry,
                ctx: testCtx,
            });

            expect(result.toolsExecuted).toBe(false);
            expect(result.roundsCompleted).toBe(0);
            expect(result.replyText).toBe('Hello! How can I help you today?');
            expect(mockChat).toHaveBeenCalledTimes(1);
        });
    });

    describe('limits enforcement', () => {
        it('should enforce max tool rounds (2)', async () => {
            // Round 1
            mockChat.mockResolvedValueOnce({
                content: JSON.stringify({
                    type: 'tool_calls',
                    calls: [{ name: 'get_time', args: {} }],
                }),
            });

            // Round 2
            mockChat.mockResolvedValueOnce({
                content: JSON.stringify({
                    type: 'tool_calls',
                    calls: [{ name: 'get_time', args: {} }],
                }),
            });

            // Final answer after max rounds
            mockChat.mockResolvedValueOnce({
                content: 'Final answer after max rounds.',
            });

            const result = await runToolCallLoop({
                client: mockClient,
                messages: [{ role: 'user', content: 'Keep calling tools' }],
                registry,
                ctx: testCtx,
                config: { maxRounds: 2 },
            });

            expect(result.roundsCompleted).toBe(2);
            expect(result.replyText).toBe('Final answer after max rounds.');
        });

        it('should enforce max calls per round (3)', async () => {
            mockChat.mockResolvedValueOnce({
                content: JSON.stringify({
                    type: 'tool_calls',
                    calls: [
                        { name: 'get_time', args: {} },
                        { name: 'get_time', args: {} },
                        { name: 'get_time', args: {} },
                        { name: 'get_time', args: {} }, // This one should be truncated
                        { name: 'get_time', args: {} }, // This one too
                    ],
                }),
            });

            mockChat.mockResolvedValueOnce({
                content: 'Done',
            });

            const result = await runToolCallLoop({
                client: mockClient,
                messages: [{ role: 'user', content: 'test' }],
                registry,
                ctx: testCtx,
                config: { maxCallsPerRound: 3 },
            });

            // Only 3 tools should have been executed
            expect(result.toolResults).toHaveLength(3);
        });
    });

    describe('deterministic retry', () => {
        it('should retry once when JSON looks almost valid', async () => {
            // First response: malformed JSON that looks like it should be JSON
            mockChat.mockResolvedValueOnce({
                content: '{"type": "tool_calls", "calls": [{"name": "get_time", args: {}}', // Missing closing brackets
            });

            // Retry response: still not valid envelope, treat as answer
            mockChat.mockResolvedValueOnce({
                content: 'I apologize, let me just answer: 12:00 PM',
            });

            const result = await runToolCallLoop({
                client: mockClient,
                messages: [{ role: 'user', content: 'time?' }],
                registry,
                ctx: testCtx,
            });

            expect(result.toolsExecuted).toBe(false);
            expect(result.replyText).toBe('I apologize, let me just answer: 12:00 PM');
            expect(mockChat).toHaveBeenCalledTimes(2);

            // Verify retry prompt was included
            const retryCall = mockChat.mock.calls[1][0];
            expect(retryCall.messages.some((m) => m.content.includes('ONLY valid JSON'))).toBe(true);
        });

        it('should retry and succeed if second response is valid', async () => {
            // First response: malformed JSON
            mockChat.mockResolvedValueOnce({
                content: '{"type": "tool_calls", calls: [{"name": "get_time"}]}', // Invalid: unquoted 'calls'
            });

            // Retry response: valid envelope
            mockChat.mockResolvedValueOnce({
                content: JSON.stringify({
                    type: 'tool_calls',
                    calls: [{ name: 'get_time', args: {} }],
                }),
            });

            // Final answer after tool execution
            mockChat.mockResolvedValueOnce({
                content: '12:00 PM',
            });

            const result = await runToolCallLoop({
                client: mockClient,
                messages: [{ role: 'user', content: 'time?' }],
                registry,
                ctx: testCtx,
            });

            expect(result.toolsExecuted).toBe(true);
            expect(result.toolResults).toHaveLength(1);
        });

        it('should not retry if response does not look like JSON', async () => {
            mockChat.mockResolvedValueOnce({
                content: 'This is just a regular text response without any JSON.',
            });

            const result = await runToolCallLoop({
                client: mockClient,
                messages: [{ role: 'user', content: 'hello' }],
                registry,
                ctx: testCtx,
            });

            expect(result.replyText).toBe('This is just a regular text response without any JSON.');
            expect(mockChat).toHaveBeenCalledTimes(1); // No retry
        });
    });

    describe('tool validation in loop', () => {
        it('should return error for unknown tool in envelope', async () => {
            mockChat.mockResolvedValueOnce({
                content: JSON.stringify({
                    type: 'tool_calls',
                    calls: [{ name: 'unknown_tool', args: {} }],
                }),
            });

            mockChat.mockResolvedValueOnce({
                content: 'Tool failed, here is my answer instead.',
            });

            const result = await runToolCallLoop({
                client: mockClient,
                messages: [{ role: 'user', content: 'test' }],
                registry,
                ctx: testCtx,
            });

            expect(result.toolResults[0].success).toBe(false);
            expect(result.toolResults[0].error).toContain('Unknown tool');
        });

        it('should return error for invalid args in envelope', async () => {
            mockChat.mockResolvedValueOnce({
                content: JSON.stringify({
                    type: 'tool_calls',
                    calls: [{ name: 'add_numbers', args: { a: 'not a number', b: 5 } }],
                }),
            });

            mockChat.mockResolvedValueOnce({
                content: 'Invalid args, answering directly.',
            });

            const result = await runToolCallLoop({
                client: mockClient,
                messages: [{ role: 'user', content: 'add stuff' }],
                registry,
                ctx: testCtx,
            });

            expect(result.toolResults[0].success).toBe(false);
            expect(result.toolResults[0].error).toContain('Invalid arguments');
        });
    });
});
