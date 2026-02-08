import { RouteKind } from '../orchestration/llmRouter';
import { CriticAssessment } from './criticAgent';

const CRITIC_ELIGIBLE_ROUTES = new Set<RouteKind>([
  'chat',
  'coding',
  'search',
  'analyze',
  'manage',
]);

export interface CriticRuntimeConfig {
  enabled: boolean;
  maxLoops: number;
  minScore: number;
}

export function normalizeCriticConfig(config: CriticRuntimeConfig): CriticRuntimeConfig {
  const loopsRaw = Number(config.maxLoops);
  const scoreRaw = Number(config.minScore);
  const safeLoops = Number.isFinite(loopsRaw) ? loopsRaw : 0;
  const safeScore = Number.isFinite(scoreRaw) ? scoreRaw : 0.7;

  return {
    enabled: !!config.enabled,
    maxLoops: Math.max(0, Math.min(2, Math.floor(safeLoops))),
    minScore: Math.max(0, Math.min(1, safeScore)),
  };
}

export function shouldRunCritic(params: {
  config: CriticRuntimeConfig;
  routeKind: RouteKind;
  draftText: string;
  isVoiceActive?: boolean;
  hasFiles?: boolean;
}): boolean {
  const normalized = normalizeCriticConfig(params.config);
  if (!normalized.enabled || normalized.maxLoops <= 0) return false;
  if (!CRITIC_ELIGIBLE_ROUTES.has(params.routeKind)) return false;
  if (!params.draftText.trim()) return false;
  if (params.draftText.includes('[SILENCE]')) return false;
  if (params.isVoiceActive) return false;
  if (params.hasFiles) return false;
  return true;
}

export function shouldRequestRevision(params: {
  assessment: CriticAssessment;
  minScore: number;
}): boolean {
  const threshold = Math.max(0, Math.min(1, params.minScore));
  if (params.assessment.verdict === 'revise') return true;
  return params.assessment.score < threshold;
}
