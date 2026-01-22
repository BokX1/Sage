import { describe, it, expect } from 'vitest';
import { detectInvocation, type DetectInvocationParams } from '../../../src/core/invoke/wakeWord';

const baseParams: DetectInvocationParams = {
  rawContent: '',
  isMentioned: false,
  isReplyToBot: false,
  wakeWords: ['sage'],
  prefixes: [], // Empty by default - no automatic prefixes
};

describe('detectInvocation', () => {
  describe('wake word at start of message', () => {
    it('should trigger when wake word is at the very start', () => {
      const result = detectInvocation({
        ...baseParams,
        rawContent: 'Sage how are you',
      });
      expect(result).not.toBeNull();
      expect(result?.kind).toBe('wakeword');
      expect(result?.cleanedText).toBe('how are you');
    });

    it('should trigger with comma after wake word', () => {
      const result = detectInvocation({
        ...baseParams,
        rawContent: 'Sage, what is the weather?',
      });
      expect(result).not.toBeNull();
      expect(result?.kind).toBe('wakeword');
    });

    it('should trigger case-insensitively', () => {
      const result = detectInvocation({
        ...baseParams,
        rawContent: 'SAGE tell me a joke',
      });
      expect(result).not.toBeNull();
      expect(result?.kind).toBe('wakeword');
    });
  });

  describe('wake word NOT at start - should NOT trigger', () => {
    it('should NOT trigger when wake word is in the middle', () => {
      const result = detectInvocation({
        ...baseParams,
        rawContent: 'I asked Sage about this',
      });
      expect(result).toBeNull();
    });

    it('should NOT trigger when wake word is at the end', () => {
      const result = detectInvocation({
        ...baseParams,
        rawContent: 'What do you think Sage',
      });
      expect(result).toBeNull();
    });

    it('should NOT trigger when wake word is part of another word', () => {
      const result = detectInvocation({
        ...baseParams,
        rawContent: 'Sagebrush is a plant',
      });
      expect(result).toBeNull();
    });
  });

  describe('prefixes behavior', () => {
    it('should NOT trigger on "hey" without prefix configured', () => {
      const result = detectInvocation({
        ...baseParams,
        prefixes: [], // No prefixes
        rawContent: 'hey John how are you',
      });
      expect(result).toBeNull();
    });

    it('should trigger on "hey sage" when prefix is configured', () => {
      const result = detectInvocation({
        ...baseParams,
        prefixes: ['hey'],
        rawContent: 'hey sage what time is it',
      });
      expect(result).not.toBeNull();
      expect(result?.kind).toBe('wakeword');
    });

    it('should NOT trigger on "hey john" even with hey prefix - wake word must follow', () => {
      const result = detectInvocation({
        ...baseParams,
        prefixes: ['hey'],
        rawContent: 'hey john how are you',
      });
      expect(result).toBeNull();
    });
  });

  describe('mention and reply handling', () => {
    it('should return mention kind when bot is mentioned', () => {
      const result = detectInvocation({
        ...baseParams,
        rawContent: '<@123456789> hello',
        isMentioned: true,
      });
      expect(result).not.toBeNull();
      expect(result?.kind).toBe('mention');
    });

    it('should return reply kind when replying to bot', () => {
      const result = detectInvocation({
        ...baseParams,
        rawContent: 'thanks for the help',
        isReplyToBot: true,
      });
      expect(result).not.toBeNull();
      expect(result?.kind).toBe('reply');
    });
  });

  describe('edge cases', () => {
    it('should NOT trigger on empty message', () => {
      const result = detectInvocation({
        ...baseParams,
        rawContent: '',
      });
      expect(result).toBeNull();
    });

    it('should NOT trigger on wake word only (no actual message)', () => {
      const result = detectInvocation({
        ...baseParams,
        rawContent: 'Sage',
      });
      expect(result).toBeNull();
    });

    it('should handle leading punctuation before wake word', () => {
      const result = detectInvocation({
        ...baseParams,
        rawContent: '...sage hello',
      });
      expect(result).not.toBeNull();
      expect(result?.kind).toBe('wakeword');
    });
  });
});
