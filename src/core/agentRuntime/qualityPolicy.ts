import { AgentKind } from '../orchestration/agentSelector';
import { CriticAssessment } from './criticAgent';

const CRITIC_ELIGIBLE_ROUTES = new Set<AgentKind>([
  'chat',
  'coding',
  'search',
]);

const SEARCH_REFRESH_ISSUE_PATTERN =
  /(fact|factual|accuracy|accurate|hallucin|citation|source|evidence|verify|outdated|latest|current|incomplete|missing|unclear|stale|wrong|incorrect)/i;
const SEARCH_REFRESH_STRONG_SIGNAL_PATTERN =
  /(fact|factual|accuracy|accurate|hallucin|citation|source|evidence|verify|outdated|latest|current|stale|wrong|incorrect)/i;
const SEARCH_PROVIDER_RUNTIME_ISSUE_PATTERN =
  /(provider|searxng|crawl4ai|tavily|exa|firecrawl|jina|pollinations|timeout|timed out|econnrefused|network|connection|unreachable|fallback)/i;
const SEARCH_TIME_SENSITIVE_USER_PATTERN =
  /(latest|today|current|now|right now|as of|recent|fresh|newest|release|version|price|weather|news|score)/i;
const SEARCH_SOURCE_REQUEST_PATTERN = /(source|sources|citation|cite|reference|references|link|url)/i;
const SEARCH_SOURCE_CUE_PATTERN =
  /(?:https?:\/\/|www\.)[^\s<>()]+|(?:^|\s)(?:[a-z0-9-]+\.)+(?:com|org|net|gov|edu|io|ai|dev|co|us|uk|ca|de|fr|jp|au|in)(?:\b|\/)/i;
const SEARCH_SUSPICIOUS_CERTAINTY_PATTERN =
  /(trust me|definitely|always|never|forever|guaranteed|100%|no need to verify)/i;

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
  skip?: boolean;
}): boolean {
  const normalized = normalizeCriticConfig(params.config);
  if (params.skip) return false;
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
  // Do not thrash search refresh loops for pure provider/runtime outages.
  if (
    SEARCH_PROVIDER_RUNTIME_ISSUE_PATTERN.test(issueBlob) &&
    !SEARCH_REFRESH_STRONG_SIGNAL_PATTERN.test(issueBlob)
  ) {
    return false;
  }
  return SEARCH_REFRESH_ISSUE_PATTERN.test(issueBlob);
}

export function shouldForceSearchRefreshFromDraft(params: {
  routeKind: AgentKind;
  userText: string;
  draftText: string;
}): boolean {
  if (params.routeKind !== 'search') return false;
  const userText = params.userText.trim();
  const draftText = params.draftText.trim();
  if (!userText || !draftText) return false;

  const asksFreshness = SEARCH_TIME_SENSITIVE_USER_PATTERN.test(userText);
  const asksSources = SEARCH_SOURCE_REQUEST_PATTERN.test(userText);
  const hasSourceCue = SEARCH_SOURCE_CUE_PATTERN.test(draftText);
  const hasSuspiciousCertainty = SEARCH_SUSPICIOUS_CERTAINTY_PATTERN.test(draftText);

  if (hasSuspiciousCertainty) return true;
  if ((asksFreshness || asksSources) && !hasSourceCue) return true;
  return false;
}
