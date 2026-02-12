import { describe, expect, it } from 'vitest';
import {
  normalizeCriticConfig,
  shouldForceSearchRefreshFromDraft,
  shouldRefreshSearchFromCritic,
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
      routeKind: 'chat',
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
        routeKind: 'chat',
        draftText: 'answer',
        isVoiceActive: true,
        hasFiles: false,
      }),
    ).toBe(false);

    expect(
      shouldRunCritic({
        config: { enabled: true, maxLoops: 1, minScore: 0.7 },
        routeKind: 'chat',
        draftText: 'answer',
        isVoiceActive: false,
        hasFiles: true,
      }),
    ).toBe(false);
  });

  it('disables critic when runtime marks the draft as terminal fallback', () => {
    expect(
      shouldRunCritic({
        config: { enabled: true, maxLoops: 1, minScore: 0.7 },
        routeKind: 'search',
        draftText: "I couldn't complete the search request at this time.",
        isVoiceActive: false,
        hasFiles: false,
        skip: true,
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

  it('triggers search refresh on critic factuality issues', () => {
    expect(
      shouldRefreshSearchFromCritic({
        routeKind: 'search',
        issues: ['Missing source citation and likely outdated claim.'],
        rewritePrompt: '',
      }),
    ).toBe(true);
  });

  it('does not trigger search refresh for non-search routes', () => {
    expect(
      shouldRefreshSearchFromCritic({
        routeKind: 'chat',
        issues: ['Could be clearer.'],
        rewritePrompt: 'Improve tone.',
      }),
    ).toBe(false);
  });

  it('does not trigger search refresh for provider-runtime outages without factual issues', () => {
    expect(
      shouldRefreshSearchFromCritic({
        routeKind: 'search',
        issues: ['SearXNG provider timed out; network unreachable.'],
        rewritePrompt: 'Retry provider fallback only.',
      }),
    ).toBe(false);
  });

  it('still triggers search refresh when runtime outages also include factual/source concerns', () => {
    expect(
      shouldRefreshSearchFromCritic({
        routeKind: 'search',
        issues: ['Provider timed out and source citations are missing for latest claim.'],
        rewritePrompt: '',
      }),
    ).toBe(true);
  });

  it('forces search refresh when freshness/source asks have no source cues', () => {
    expect(
      shouldForceSearchRefreshFromDraft({
        routeKind: 'search',
        userText: 'What is the latest Node.js LTS? Include sources.',
        draftText: 'Node.js LTS is v24.',
      }),
    ).toBe(true);
  });

  it('forces search refresh on suspicious certainty phrases', () => {
    expect(
      shouldForceSearchRefreshFromDraft({
        routeKind: 'search',
        userText: 'What is the current TS version?',
        draftText: 'It is definitely 9.9 forever, trust me.',
      }),
    ).toBe(true);
  });

  it('does not force search refresh when sources are present', () => {
    expect(
      shouldForceSearchRefreshFromDraft({
        routeKind: 'search',
        userText: 'What is the latest Node.js LTS? Include sources.',
        draftText:
          'As of this answer, check nodejs.org/en/about/previous-releases and nodejs.org/en/download for the current LTS line.',
      }),
    ).toBe(false);
  });
});
