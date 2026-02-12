import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../../src/core/agentRuntime/toolRegistry';
import { runToolCallLoop } from '../../../src/core/agentRuntime/toolCallLoop';
import { LLMClient, LLMRequest, LLMResponse } from '../../../src/core/llm/llm-types';

// Mock logger
vi.mock('../../../src/core/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('toolCallLoop', () => {

  describe('config validation', () => {
    it('throws when maxRounds is invalid', async () => {
      await expect(
        runToolCallLoop({
          client: mockClient,
          messages: [{ role: 'user', content: 'Hi' }],
          registry,
          ctx: testCtx,
          config: { maxRounds: 0 },
        }),
      ).rejects.toThrow('maxRounds must be a positive integer');
    });

    it('throws when maxCallsPerRound or toolTimeoutMs are invalid', async () => {
      await expect(
        runToolCallLoop({
          client: mockClient,
          messages: [{ role: 'user', content: 'Hi' }],
          registry,
          ctx: testCtx,
          config: { maxCallsPerRound: -1 },
        }),
      ).rejects.toThrow('maxCallsPerRound must be a positive integer');

      await expect(
        runToolCallLoop({
          client: mockClient,
          messages: [{ role: 'user', content: 'Hi' }],
          registry,
          ctx: testCtx,
          config: { toolTimeoutMs: Number.NaN },
        }),
      ).rejects.toThrow('toolTimeoutMs must be a positive integer');
    });
  });

  let registry: ToolRegistry;
  let mockClient: LLMClient;
  let mockChat: ReturnType<typeof vi.fn<[LLMRequest], Promise<LLMResponse>>>;
  let getTimeExecute: ReturnType<typeof vi.fn>;

  const testCtx = {
    traceId: 'test-trace',
    userId: 'user-1',
    channelId: 'channel-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup registry with test tools
    registry = new ToolRegistry();
    getTimeExecute = vi.fn().mockResolvedValue({ time: '12:00 PM' });

    registry.register({
      name: 'get_time',
      description: 'Get the current time',
      schema: z.object({}),
      execute: getTimeExecute,
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
    it('should consume a pre-fetched envelope without an extra first-round LLM call', async () => {
      mockChat.mockResolvedValueOnce({
        content: 'The current time is 12:00 PM.',
      });

      const result = await runToolCallLoop({
        client: mockClient,
        messages: [{ role: 'user', content: 'What time is it?' }],
        registry,
        ctx: testCtx,
        initialAssistantResponseText: JSON.stringify({
          type: 'tool_calls',
          calls: [{ name: 'get_time', args: {} }],
        }),
      });

      expect(result.toolsExecuted).toBe(true);
      expect(result.roundsCompleted).toBe(1);
      expect(result.toolResults).toHaveLength(1);
      expect(result.replyText).toBe('The current time is 12:00 PM.');
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

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
        content:
          '```json\n{"type": "tool_calls", "calls": [{"name": "get_time", "args": {}}]}\n```',
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

    it('runs a plain-text finalization pass when final model response is still an envelope', async () => {
      mockChat.mockResolvedValueOnce({
        content: JSON.stringify({
          type: 'tool_calls',
          calls: [{ name: 'get_time', args: {} }],
        }),
      });
      mockChat.mockResolvedValueOnce({
        content: JSON.stringify({
          type: 'tool_calls',
          calls: [{ name: 'get_time', args: {} }],
        }),
      });
      mockChat.mockResolvedValueOnce({
        content: 'Final plain-text answer after tool rounds.',
      });

      const result = await runToolCallLoop({
        client: mockClient,
        messages: [{ role: 'user', content: 'What time is it?' }],
        registry,
        ctx: testCtx,
        config: { maxRounds: 1 },
      });

      expect(result.toolsExecuted).toBe(true);
      expect(result.roundsCompleted).toBe(1);
      expect(result.replyText).toBe('Final plain-text answer after tool rounds.');
      expect(mockChat).toHaveBeenCalledTimes(3);
      expect(mockChat.mock.calls[2][0].tools).toBeUndefined();
    });

    it('returns a safe fallback when plain-text finalization pass fails', async () => {
      mockChat.mockResolvedValueOnce({
        content: JSON.stringify({
          type: 'tool_calls',
          calls: [{ name: 'get_time', args: {} }],
        }),
      });
      mockChat.mockResolvedValueOnce({
        content: JSON.stringify({
          type: 'tool_calls',
          calls: [{ name: 'get_time', args: {} }],
        }),
      });
      mockChat.mockRejectedValueOnce(new Error('finalization timeout'));

      const result = await runToolCallLoop({
        client: mockClient,
        messages: [{ role: 'user', content: 'What time is it?' }],
        registry,
        ctx: testCtx,
        config: { maxRounds: 1 },
      });

      expect(result.toolsExecuted).toBe(true);
      expect(result.roundsCompleted).toBe(1);
      expect(result.replyText).toBe(
        'I could not finalize a plain-text answer after tool execution. Please try again.',
      );
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
      expect(result.policyDecisions).toHaveLength(5);
      expect(
        result.policyDecisions.filter((decision) => decision.code === 'max_calls_per_round_truncated'),
      ).toHaveLength(2);
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

  describe('tool policy gating', () => {
    it('blocks metadata-classified network read tools when policy disallows them', async () => {
      const fetchDocsExecute = vi.fn().mockResolvedValue({ ok: true });
      registry.register({
        name: 'fetch_docs',
        description: 'Fetch docs from network',
        schema: z.object({}),
        metadata: { riskClass: 'network_read' },
        execute: fetchDocsExecute,
      });

      mockChat.mockResolvedValueOnce({
        content: JSON.stringify({
          type: 'tool_calls',
          calls: [{ name: 'fetch_docs', args: {} }],
        }),
      });

      mockChat.mockResolvedValueOnce({
        content: 'Cannot fetch docs right now.',
      });

      const result = await runToolCallLoop({
        client: mockClient,
        messages: [{ role: 'user', content: 'Fetch docs now' }],
        registry,
        ctx: testCtx,
        toolPolicy: {
          allowNetworkRead: false,
          allowDataExfiltrationRisk: true,
          allowExternalWrite: false,
          allowHighRisk: false,
          blockedTools: [],
        },
      });

      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults[0].success).toBe(false);
      expect(result.toolResults[0].error).toContain('network reads');
      expect(result.policyDecisions).toHaveLength(1);
      expect(result.policyDecisions[0].code).toBe('network_read_disabled');
      expect(fetchDocsExecute).not.toHaveBeenCalled();
    });

    it('blocks external side-effect tools when policy disallows them', async () => {
      const leaveVoiceExecute = vi.fn().mockResolvedValue({ ok: true });
      registry.register({
        name: 'leave_voice',
        description: 'Leave a voice channel',
        schema: z.object({}),
        execute: leaveVoiceExecute,
      });

      mockChat.mockResolvedValueOnce({
        content: JSON.stringify({
          type: 'tool_calls',
          calls: [{ name: 'leave_voice', args: {} }],
        }),
      });

      mockChat.mockResolvedValueOnce({
        content: 'Cannot perform that action right now.',
      });

      const result = await runToolCallLoop({
        client: mockClient,
        messages: [{ role: 'user', content: 'Leave voice now' }],
        registry,
        ctx: testCtx,
        toolPolicy: {
          allowNetworkRead: true,
          allowDataExfiltrationRisk: true,
          allowExternalWrite: false,
          allowHighRisk: false,
          blockedTools: [],
        },
      });

      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults[0].success).toBe(false);
      expect(result.toolResults[0].error).toContain('external side effects');
      expect(result.policyDecisions).toHaveLength(1);
      expect(result.policyDecisions[0].code).toBe('external_write_disabled');
      expect(leaveVoiceExecute).not.toHaveBeenCalled();
    });
  });

  describe('tool result caching', () => {
    it('reuses cached tool results across rounds for identical calls', async () => {
      mockChat
        .mockResolvedValueOnce({
          content: JSON.stringify({
            type: 'tool_calls',
            calls: [{ name: 'get_time', args: {} }],
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            type: 'tool_calls',
            calls: [{ name: 'get_time', args: {} }],
          }),
        })
        .mockResolvedValueOnce({
          content: 'Done.',
        });

      const result = await runToolCallLoop({
        client: mockClient,
        messages: [{ role: 'user', content: 'call get_time twice' }],
        registry,
        ctx: testCtx,
        config: {
          maxRounds: 2,
          cacheEnabled: true,
          cacheMaxEntries: 10,
        },
      });

      expect(result.roundsCompleted).toBe(2);
      expect(result.toolResults).toHaveLength(2);
      expect(result.toolResults.every((item) => item.success)).toBe(true);
      expect(result.policyDecisions).toHaveLength(2);
      expect(result.policyDecisions.every((decision) => decision.code === 'allow_unconfigured')).toBe(
        true,
      );
      expect(getTimeExecute).toHaveBeenCalledTimes(1);
    });
  });
});
