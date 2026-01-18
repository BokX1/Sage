import { describe, it, expect } from 'vitest';
import { cleanJsonOutput } from './summarizeChannelWindow';

describe('cleanJsonOutput', () => {
    it('returns clean JSON unchanged', () => {
        const input = '{"foo":"bar"}';
        expect(cleanJsonOutput(input)).toBe(input);
    });

    it('extracts JSON from markdown code blocks', () => {
        const input = 'Here is the JSON:\n```json\n{"foo":"bar"}\n```';
        expect(cleanJsonOutput(input)).toBe('{"foo":"bar"}');
    });

    it('extracts JSON from generic code blocks', () => {
        const input = '```\n{"foo":"bar"}\n```';
        expect(cleanJsonOutput(input)).toBe('{"foo":"bar"}');
    });

    it('extracts JSON embedded in text without code blocks', () => {
        const input = 'Here is the JSON: {"foo":"bar"} Thanks!';
        expect(cleanJsonOutput(input)).toBe('{"foo":"bar"}');
    });

    it('handles nested JSON correctly when locating braces', () => {
        const input = 'Prefix {"foo": {"bar": "baz"}} Suffix';
        expect(cleanJsonOutput(input)).toBe('{"foo": {"bar": "baz"}}');
    });

    it('prioritizes code blocks over partial braces', () => {
        const input = 'Ignore this { broken json }... ```json\n{"valid":"json"}\n```';
        expect(cleanJsonOutput(input)).toBe('{"valid":"json"}');
    });
});
