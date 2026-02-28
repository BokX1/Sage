import { describe, expect, it } from 'vitest';
import {
  computeEvalOverallScore,
  evaluateAggregateScore,
  normalizeEvalDimensionScores,
} from '../../../src/core/agentRuntime/evalScorer';

describe('evalScorer', () => {
  it('normalizes numeric and string inputs and clamps out-of-range values', () => {
    const normalized = normalizeEvalDimensionScores({
      factual_grounding: '0.9',
      instruction_adherence: 1.5,
      safety: -2,
      completeness: 'not-a-number',
      tool_use_correctness: 0.7,
      source_quality: undefined,
      temporal_correctness: 0.42,
    });

    expect(normalized).toEqual({
      factual_grounding: 0.9,
      instruction_adherence: 1,
      safety: 0,
      completeness: 0,
      tool_use_correctness: 0.7,
      source_quality: 0,
      temporal_correctness: 0.42,
    });
  });

  it('computes weighted overall score', () => {
    const score = computeEvalOverallScore({
      factual_grounding: 1,
      instruction_adherence: 0.8,
      safety: 1,
      completeness: 0.7,
      tool_use_correctness: 0.5,
      source_quality: 0.8,
      temporal_correctness: 0.6,
    });

    expect(score).toBeCloseTo(0.824, 4);
  });

  it('returns pass only when above threshold with no hard-fail dimensions', () => {
    const pass = evaluateAggregateScore({
      scores: {
        factual_grounding: 0.86,
        instruction_adherence: 0.82,
        safety: 0.91,
        completeness: 0.8,
        tool_use_correctness: 0.75,
        source_quality: 0.78,
        temporal_correctness: 0.74,
      },
      confidence: 0.88,
      passThreshold: 0.75,
      hardFailThreshold: 0.45,
    });

    expect(pass.verdict).toBe('pass');
    expect(pass.hardFailDimensions).toEqual([]);
    expect(pass.confidence).toBe(0.88);

    const revise = evaluateAggregateScore({
      scores: {
        factual_grounding: 0.86,
        instruction_adherence: 0.82,
        safety: 0.4,
        completeness: 0.8,
        tool_use_correctness: 0.75,
        source_quality: 0.78,
        temporal_correctness: 0.74,
      },
      confidence: 0.9,
      passThreshold: 0.75,
      hardFailThreshold: 0.45,
    });

    expect(revise.verdict).toBe('revise');
    expect(revise.hardFailDimensions).toEqual(['safety']);
  });
});
