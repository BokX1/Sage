import { describe, it, expect } from 'vitest';
import { decideRoute } from '../../../src/core/orchestration/router';

describe('Router', () => {
  describe('decideRoute', () => {
    it('should route to summarize for "summarize" keyword', () => {
      const result = decideRoute({
        userText: 'Can you summarize the discussion?',
        invokedBy: 'mention',
        hasGuild: true,
      });

      expect(result.kind).toBe('summarize');
      expect(result.experts).toContain('Summarizer');
      expect(result.experts).toContain('Memory');
      expect(result.temperature).toBe(0.3);
    });

    it('should route to voice_analytics for "who in voice"', () => {
      const result = decideRoute({
        userText: "Who's in voice right now?",
        invokedBy: 'mention',
        hasGuild: true,
      });

      expect(result.kind).toBe('voice_analytics');
      expect(result.experts).toContain('VoiceAnalytics');
      expect(result.temperature).toBe(0.5);
    });

    it('should route to social_graph for "whoiswho"', () => {
      const result = decideRoute({
        userText: 'whoiswho for Alice?',
        invokedBy: 'mention',
        hasGuild: true,
      });

      expect(result.kind).toBe('social_graph');
      expect(result.experts).toContain('SocialGraph');
    });

    it('should route to memory for "remember" keyword', () => {
      const result = decideRoute({
        userText: 'What do you remember about me?',
        invokedBy: 'mention',
        hasGuild: true,
      });

      expect(result.kind).toBe('memory');
      expect(result.experts).toContain('Memory');
      expect(result.temperature).toBe(0.6);
    });

    it('should route to admin for command invocation', () => {
      const result = decideRoute({
        userText: 'Show stats',
        invokedBy: 'command',
        hasGuild: true,
      });

      expect(result.kind).toBe('admin');
      expect(result.experts).toContain('SocialGraph');
      expect(result.experts).toContain('VoiceAnalytics');
      expect(result.allowTools).toBe(true);
    });

    it('should route to qa as fallback', () => {
      const result = decideRoute({
        userText: 'What is the weather today?',
        invokedBy: 'mention',
        hasGuild: false,
      });

      expect(result.kind).toBe('qa');
      expect(result.experts).toContain('Memory');
      expect(result.temperature).toBe(0.8);
      expect(result.allowTools).toBe(true);
    });

    it('should route "recap" to summarize', () => {
      const result = decideRoute({
        userText: 'Give me a recap',
        invokedBy: 'reply',
        hasGuild: true,
      });

      expect(result.kind).toBe('summarize');
    });

    it('should route "how long in voice today" to voice_analytics', () => {
      const result = decideRoute({
        userText: 'How long have I been in voice today?',
        invokedBy: 'mention',
        hasGuild: true,
      });

      expect(result.kind).toBe('voice_analytics');
    });

    it('should route "closest to" to social_graph', () => {
      const result = decideRoute({
        userText: 'Who am I closest to?',
        invokedBy: 'mention',
        hasGuild: true,
      });

      expect(result.kind).toBe('social_graph');
    });
  });
});
