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
      toolJson: {
        enabled: true,
        main: {
          toolsExecuted: true,
          successfulToolCount: 2,
          hardGateRequired: true,
          hardGateSatisfied: true,
        },
      },
      qualityJson: { critic: [{ score: 0.9, verdict: 'pass' }] },
      budgetJson: { failedTasks: 0 },
    });

    expect(score.successLikely).toBe(true);
    expect(score.score).toBeGreaterThan(0.7);
  });

  it('keeps backward compatibility with legacy executed tool flag', () => {
    const score = scoreTraceOutcome({
      routeKind: 'chat',
      replyText: 'Response with legacy tool telemetry.',
      toolJson: { executed: true },
    });

    expect(score.score).toBeGreaterThan(0.7);
  });

  it('adds search source-risk hint when missing citation cue', () => {
    const score = scoreTraceOutcome({
      routeKind: 'search',
      replyText: 'Latest update is X.',
    });

    expect(score.riskFlags).toContain('search_no_sources_hint');
  });

  it('does not add search source-risk when URL cues are present', () => {
    const score = scoreTraceOutcome({
      routeKind: 'search',
      replyText: 'Latest update is X. Source URLs: https://example.com/news',
    });

    expect(score.riskFlags).not.toContain('search_no_sources_hint');
  });

  it('penalizes unmet hard gate telemetry', () => {
    const score = scoreTraceOutcome({
      routeKind: 'search',
      replyText: 'I could not verify with tools.',
      toolJson: {
        enabled: true,
        main: {
          toolsExecuted: false,
          hardGateRequired: true,
          hardGateSatisfied: false,
          failed: true,
        },
      },
    });

    expect(score.successLikely).toBe(false);
    expect(score.riskFlags).toContain('tool_hard_gate_failed');
    expect(score.riskFlags).toContain('tool_loop_failed');
  });
});
