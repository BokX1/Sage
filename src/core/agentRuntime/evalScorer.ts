export type EvalDimensionKey =
  | 'factual_grounding'
  | 'instruction_adherence'
  | 'safety'
  | 'completeness'
  | 'tool_use_correctness'
  | 'source_quality'
  | 'temporal_correctness';

export interface EvalDimensionScores {
  factual_grounding: number;
  instruction_adherence: number;
  safety: number;
  completeness: number;
  tool_use_correctness: number;
  source_quality: number;
  temporal_correctness: number;
}

export type EvalScoreWeights = EvalDimensionScores;

export interface EvalAggregateScore {
  overallScore: number;
  verdict: 'pass' | 'revise';
  hardFailDimensions: EvalDimensionKey[];
  confidence: number;
}

export const DEFAULT_EVAL_SCORE_WEIGHTS: EvalScoreWeights = {
  factual_grounding: 0.22,
  instruction_adherence: 0.16,
  safety: 0.2,
  completeness: 0.14,
  tool_use_correctness: 0.1,
  source_quality: 0.1,
  temporal_correctness: 0.08,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return Number.NaN;
}

function round(value: number, precision = 4): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function normalizeEvalDimensionScores(value: unknown): EvalDimensionScores {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    factual_grounding: clamp01(toNumber(record.factual_grounding)),
    instruction_adherence: clamp01(toNumber(record.instruction_adherence)),
    safety: clamp01(toNumber(record.safety)),
    completeness: clamp01(toNumber(record.completeness)),
    tool_use_correctness: clamp01(toNumber(record.tool_use_correctness)),
    source_quality: clamp01(toNumber(record.source_quality)),
    temporal_correctness: clamp01(toNumber(record.temporal_correctness)),
  };
}

export function computeEvalOverallScore(
  scores: EvalDimensionScores,
  weights: EvalScoreWeights = DEFAULT_EVAL_SCORE_WEIGHTS,
): number {
  const totalWeight =
    weights.factual_grounding +
    weights.instruction_adherence +
    weights.safety +
    weights.completeness +
    weights.tool_use_correctness +
    weights.source_quality +
    weights.temporal_correctness;
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return 0;

  const weightedTotal =
    scores.factual_grounding * weights.factual_grounding +
    scores.instruction_adherence * weights.instruction_adherence +
    scores.safety * weights.safety +
    scores.completeness * weights.completeness +
    scores.tool_use_correctness * weights.tool_use_correctness +
    scores.source_quality * weights.source_quality +
    scores.temporal_correctness * weights.temporal_correctness;

  return clamp01(weightedTotal / totalWeight);
}

export function evaluateAggregateScore(params: {
  scores: EvalDimensionScores;
  confidence: number;
  passThreshold?: number;
  hardFailThreshold?: number;
  weights?: EvalScoreWeights;
}): EvalAggregateScore {
  const passThreshold = clamp01(params.passThreshold ?? 0.75);
  const hardFailThreshold = clamp01(params.hardFailThreshold ?? 0.45);
  const overallScore = computeEvalOverallScore(
    params.scores,
    params.weights ?? DEFAULT_EVAL_SCORE_WEIGHTS,
  );

  const hardFailDimensions: EvalDimensionKey[] = (
    Object.keys(params.scores) as EvalDimensionKey[]
  ).filter((dimension) => params.scores[dimension] < hardFailThreshold);

  const verdict: 'pass' | 'revise' =
    overallScore >= passThreshold && hardFailDimensions.length === 0 ? 'pass' : 'revise';

  return {
    overallScore: round(overallScore),
    verdict,
    hardFailDimensions,
    confidence: round(clamp01(params.confidence)),
  };
}
