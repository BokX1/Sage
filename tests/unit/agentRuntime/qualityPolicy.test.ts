import { describe, expect, it } from 'vitest';
import {
  normalizeCriticConfig,
  shouldRequestRevision,
  shouldRunCritic,
} from '../../../src/core/agentRuntime/qualityPolicy';

describe('qualityPolicy', () => {
  it('normalizes critic config into safe bounds', () => {
    const normalized = normalizeCriticConfig({
      enabled: true,
      maxLoops: 99,
      minScore: 9,
    });

    expect(normalized.maxLoops).toBe(2);
    expect(normalized.minScore).toBe(1);
  });

  it('enables critic for eligible routes with valid draft text', () => {
    const enabled = shouldRunCritic({
      config: { enabled: true, maxLoops: 1, minScore: 0.7 },
      routeKind: 'qa',
      draftText: 'Here is an answer.',
      isVoiceActive: false,
      hasFiles: false,
    });

    expect(enabled).toBe(true);
  });

  it('disables critic for voice mode or file responses', () => {
    expect(
      shouldRunCritic({
        config: { enabled: true, maxLoops: 1, minScore: 0.7 },
        routeKind: 'qa',
        draftText: 'answer',
        isVoiceActive: true,
        hasFiles: false,
      }),
    ).toBe(false);

    expect(
      shouldRunCritic({
        config: { enabled: true, maxLoops: 1, minScore: 0.7 },
        routeKind: 'qa',
        draftText: 'answer',
        isVoiceActive: false,
        hasFiles: true,
      }),
    ).toBe(false);
  });

  it('requests revision on low score or revise verdict', () => {
    expect(
      shouldRequestRevision({
        assessment: {
          score: 0.2,
          verdict: 'pass',
          issues: [],
          rewritePrompt: '',
          model: 'deepseek',
        },
        minScore: 0.7,
      }),
    ).toBe(true);

    expect(
      shouldRequestRevision({
        assessment: {
          score: 0.95,
          verdict: 'revise',
          issues: [],
          rewritePrompt: '',
          model: 'deepseek',
        },
        minScore: 0.7,
      }),
    ).toBe(true);
  });
});
