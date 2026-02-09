import { describe, expect, it } from 'vitest';
import { scoreTraceOutcome } from '../../../src/core/agentRuntime/outcomeScorer';

describe('outcomeScorer', () => {
  it('flags empty fallback replies as low confidence', () => {
    const score = scoreTraceOutcome({
      routeKind: 'chat',
      replyText: "I'm having trouble connecting right now. Please try again later.",
      budgetJson: { failedTasks: 2 },
    });

    expect(score.successLikely).toBe(false);
    expect(score.score).toBeLessThan(0.4);
    expect(score.riskFlags).toContain('runtime_fallback');
    expect(score.riskFlags).toContain('agent_failures');
  });

  it('scores healthy responses positively', () => {
    const score = scoreTraceOutcome({
      routeKind: 'chat',
      replyText: 'Here is a concrete answer with clear steps.',
      toolJson: { executed: true },
      qualityJson: { critic: [{ score: 0.9, verdict: 'pass' }] },
      budgetJson: { failedTasks: 0 },
    });

    expect(score.successLikely).toBe(true);
    expect(score.score).toBeGreaterThan(0.7);
  });

  it('adds search source-risk hint when missing citation cue', () => {
    const score = scoreTraceOutcome({
      routeKind: 'search',
      replyText: 'Latest update is X.',
    });

    expect(score.riskFlags).toContain('search_no_sources_hint');
  });
});
