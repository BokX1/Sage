import { describe, expect, test } from 'vitest';
import { decideRoute } from '../../../src/core/orchestration/router';

describe('Router Intent Classifier', () => {
  const baseParams = {
    hasGuild: true,
    invokedBy: 'mention' as const,
  };

  test('Voice Analytics route match', () => {
    const phrases = [
      "Who's in voice?",
      'anyone in vc?',
      'check voice',
      'voice status',
      'who is online',
      'who is active',
      'how long have i been in voice today',
    ];

    phrases.forEach((text) => {
      const decision = decideRoute({ ...baseParams, userText: text });
      expect(decision.kind).toBe('voice_analytics');
      expect(decision.experts).toContain('VoiceAnalytics');
    });
  });

  test('Summarize route match', () => {
    const phrases = [
      'Can you summarize the chat?',
      'catch me up',
      'give me a recap',
      'TLDR please',
      'what happened today',
      'what were they talking about',
    ];

    phrases.forEach((text) => {
      const decision = decideRoute({ ...baseParams, userText: text });
      expect(decision.kind).toBe('summarize');
      expect(decision.experts).toContain('Summarizer');
    });
  });

  test('Social Graph route match', () => {
    const phrases = [
      'Who is closest to me?',
      'Who works with Itris?',
      'show my social graph',
      'who hangs out with me',
      'my circle',
    ];

    phrases.forEach((text) => {
      const decision = decideRoute({ ...baseParams, userText: text });
      expect(decision.kind).toBe('social_graph');
      expect(decision.experts).toContain('SocialGraph');
    });
  });

  test('Memory route match', () => {
    const phrases = [
      'What do you know about me?',
      'my profile',
      'do i like pizza?',
      'what have you learned about me',
    ];

    phrases.forEach((text) => {
      const decision = decideRoute({ ...baseParams, userText: text });
      expect(decision.kind).toBe('memory');
      expect(decision.experts).toContain('Memory');
    });
  });

  test('QA route (default) match', () => {
    const phrases = [
      'Hello there',
      'What is the capital of France?',
      'Write a poem',
      'How are you?',
    ];

    phrases.forEach((text) => {
      const decision = decideRoute({ ...baseParams, userText: text });
      expect(decision.kind).toBe('qa');
    });
  });

  test('Admin route match', () => {
    const phrases = ['Sage config', 'change settings', 'manage admin'];

    phrases.forEach((text) => {
      const decision = decideRoute({ ...baseParams, userText: text });
      expect(decision.kind).toBe('admin');
    });
  });
});
