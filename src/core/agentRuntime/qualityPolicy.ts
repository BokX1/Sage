import { AgentKind } from '../orchestration/agentSelector';
import { CriticAssessment } from './criticAgent';

const CRITIC_ELIGIBLE_ROUTES = new Set<AgentKind>([
  'chat',
  'coding',
  'search',
]);

const SEARCH_REFRESH_ISSUE_PATTERN =
  /(fact|factual|accuracy|accurate|hallucin|citation|source|evidence|verify|outdated|latest|current|incomplete|missing|unclear|stale|wrong|incorrect)/i;

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
  routeKind: AgentKind;
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

export function shouldRefreshSearchFromCritic(params: {
  routeKind: AgentKind;
  issues: string[];
  rewritePrompt?: string;
}): boolean {
  if (params.routeKind !== 'search') return false;
  const issueBlob = `${params.rewritePrompt ?? ''} ${params.issues.join(' ')}`.trim();
  if (!issueBlob) return false;
  return SEARCH_REFRESH_ISSUE_PATTERN.test(issueBlob);
}
