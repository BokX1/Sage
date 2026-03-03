import { describe, expect, it } from 'vitest';
import { parseToolCallEnvelope } from '../../../src/core/agentRuntime/toolCallParser';

describe('toolCallParser', () => {
    it('parses a standard JSON envelope', () => {
        const result = parseToolCallEnvelope(
            JSON.stringify({
                type: 'tool_calls',
                calls: [{ name: 'get_time', args: {} }],
            }),
        );
        expect(result).not.toBeNull();
        expect(result!.calls).toHaveLength(1);
        expect(result!.calls[0].name).toBe('get_time');
    });

    it('parses an envelope wrapped in code fences', () => {
        const input = '```json\n{"type":"tool_calls","calls":[{"name":"web_search","args":{"query":"test"}}]}\n```';
        const result = parseToolCallEnvelope(input);
        expect(result).not.toBeNull();
        expect(result!.calls[0].name).toBe('web_search');
    });

    it('extracts an envelope from mixed text + JSON content', () => {
        const input =
            'Let me search for that information.\n\n' +
            '{"type":"tool_calls","calls":[{"name":"web_search","args":{"query":"latest news"}}]}\n\n' +
            'I will analyze the results.';
        const result = parseToolCallEnvelope(input);
        expect(result).not.toBeNull();
        expect(result!.calls).toHaveLength(1);
        expect(result!.calls[0].name).toBe('web_search');
        expect(result!.calls[0].args).toEqual({ query: 'latest news' });
    });

    it('extracts an envelope from code fences embedded in prose', () => {
        const input =
            'I need to check the current time.\n' +
            '```json\n{"type":"tool_calls","calls":[{"name":"get_time","args":{}}]}\n```\n' +
            'Then I will respond.';
        const result = parseToolCallEnvelope(input);
        expect(result).not.toBeNull();
        expect(result!.calls[0].name).toBe('get_time');
    });

    it('returns null for plain text responses', () => {
        const result = parseToolCallEnvelope('Hello! How can I help you today?');
        expect(result).toBeNull();
    });

    it('returns null for invalid JSON', () => {
        const result = parseToolCallEnvelope('{"type": "tool_calls", "calls": [invalid]}');
        expect(result).toBeNull();
    });

    it('returns null for envelope with missing calls array', () => {
        const result = parseToolCallEnvelope('{"type": "tool_calls"}');
        expect(result).toBeNull();
    });

    it('returns null for envelope with invalid call shape', () => {
        const result = parseToolCallEnvelope(
            '{"type": "tool_calls", "calls": [{"name": 123}]}',
        );
        expect(result).toBeNull();
    });

    it('returns null for envelope with blank tool names', () => {
        const result = parseToolCallEnvelope(
            '{"type": "tool_calls", "calls": [{"name": "   ", "args": {}}]}',
        );
        expect(result).toBeNull();
    });

    it('handles envelope with reasoning field from native tool calls', () => {
        const input = JSON.stringify({
            type: 'tool_calls',
            calls: [{ name: 'get_time', args: {} }],
            reasoning: 'The user wants to know the current time.',
        });
        const result = parseToolCallEnvelope(input);
        expect(result).not.toBeNull();
        expect(result!.calls[0].name).toBe('get_time');
    });
});
