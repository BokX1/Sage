import { LLMChatMessage, LLMMessageContent } from './llm-types';
import {
  findModelInCatalog,
  getDefaultModelId,
  modelSupports,
  ModelCaps,
} from './model-catalog';
import { getModelHealthScore } from './model-health';

/**
 * Inputs available when selecting an LLM model for a request.
 */
export type ResolveModelParams = {
  guildId: string | null;
  messages: LLMChatMessage[];
  route?: string;
  allowedModels?: string[];
  featureFlags?: {
    tools?: boolean;
    search?: boolean;
    reasoning?: boolean;
    audioIn?: boolean;
    audioOut?: boolean;
    codeExec?: boolean;
  };
};

type ModelRequirement = Partial<ModelCaps> & {
  inputModalities?: string[];
  outputModalities?: string[];
};

type ModelResolutionReason =
  | 'allowlist_filtered'
  | 'capability_mismatch'
  | 'catalog_miss_accept_unknown'
  | 'selected'
  | 'fallback_first_candidate';

export interface ModelCandidateDecision {
  model: string;
  accepted: boolean;
  reason: ModelResolutionReason;
  healthScore: number;
}

export interface ModelResolutionDetails {
  model: string;
  route: string;
  requirements: ModelRequirement;
  allowlistApplied: boolean;
  candidates: string[];
  decisions: ModelCandidateDecision[];
}

const ROUTE_MODEL_CHAINS: Record<string, string[]> = {
  coding: ['kimi', 'qwen-coder', 'deepseek'],
  search: ['gemini-search', 'perplexity-fast', 'perplexity-reasoning', 'nomnom'],
  analyze: ['openai-large', 'gemini-fast', 'mistral', 'kimi'],
  chat: ['openai', 'kimi', 'gemini-fast', 'claude-fast'],
  art: ['imagen-4', 'flux', 'flux-2-dev', 'klein'],
  manage: ['gemini-fast', 'openai-fast'],
};

function hasPart(messages: LLMChatMessage[], type: 'image_url' | 'input_audio'): boolean {
  return messages.some((message) => {
    const content: LLMMessageContent = message.content;
    if (!Array.isArray(content)) return false;
    return content.some((part) => part.type === type);
  });
}

function estimateUserPromptChars(messages: LLMChatMessage[]): number {
  return messages
    .filter((message) => message.role === 'user')
    .reduce((total, message) => {
      if (typeof message.content === 'string') {
        return total + message.content.length;
      }
      const textLength = message.content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .reduce((sum, part) => sum + part.text.length, 0);
      return total + textLength;
    }, 0);
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function buildBaseCandidateChain(params: ResolveModelParams): string[] {
  const route = (params.route ?? 'chat').toLowerCase();
  const defaultChain = ROUTE_MODEL_CHAINS[route] ?? ROUTE_MODEL_CHAINS.chat;
  const isLongForm = estimateUserPromptChars(params.messages) >= 1200;
  const hasVisionInput = hasPart(params.messages, 'image_url');
  const hasAudioInput = hasPart(params.messages, 'input_audio') || !!params.featureFlags?.audioIn;
  const hasAudioOutput = !!params.featureFlags?.audioOut;

  const candidates: string[] = [...defaultChain];

  if (route === 'chat' && isLongForm) {
    candidates.unshift('openai');
  }

  if (params.featureFlags?.reasoning && route !== 'coding') {
    candidates.unshift('deepseek');
  }

  if (hasVisionInput && route === 'coding') {
    candidates.unshift('openai-fast');
  }

  if (hasAudioInput || hasAudioOutput) {
    candidates.unshift('openai-audio');
  }

  candidates.push(getDefaultModelId());
  return dedupe(candidates);
}

export function getPreferredModel(route: string): string {
  const chain = ROUTE_MODEL_CHAINS[route] ?? ROUTE_MODEL_CHAINS['chat'];
  return chain[0] ?? getDefaultModelId();
}

function applyAllowedModels(
  candidates: string[],
  allowedModels: string[] | undefined,
): { candidates: string[]; allowlistApplied: boolean; allowedSet: Set<string> | null } {
  const normalizedAllowed = dedupe(allowedModels ?? []);
  if (normalizedAllowed.length === 0) {
    return {
      candidates,
      allowlistApplied: false,
      allowedSet: null,
    };
  }

  const allowedSet = new Set(normalizedAllowed);
  const filtered = candidates.filter((candidate) => allowedSet.has(candidate));
  for (const allowed of normalizedAllowed) {
    if (!filtered.includes(allowed)) {
      filtered.push(allowed);
    }
  }

  return {
    candidates: dedupe(filtered),
    allowlistApplied: true,
    allowedSet,
  };
}

function rankByHealth(candidates: string[]): string[] {
  if (candidates.length <= 1) return candidates;
  const maxIndex = Math.max(1, candidates.length - 1);

  return [...candidates]
    .map((candidate, index) => {
      const healthScore = getModelHealthScore(candidate);
      const priorityScore = 1 - index / maxIndex;
      const weighted = healthScore * 0.85 + priorityScore * 0.15;
      return {
        candidate,
        index,
        weighted,
      };
    })
    .sort((a, b) => {
      if (b.weighted !== a.weighted) return b.weighted - a.weighted;
      return a.index - b.index;
    })
    .map((entry) => entry.candidate);
}

function buildRequirements(params: ResolveModelParams): ModelRequirement {
  const hasVisionInput = hasPart(params.messages, 'image_url');
  const hasAudioInput = hasPart(params.messages, 'input_audio') || !!params.featureFlags?.audioIn;

  return {
    vision: hasVisionInput || undefined,
    audioIn: hasAudioInput || undefined,
    audioOut: params.featureFlags?.audioOut || undefined,
    tools: params.featureFlags?.tools || undefined,
    search:
      params.featureFlags?.search || (params.route ?? '').toLowerCase() === 'search' || undefined,
    reasoning: params.featureFlags?.reasoning || undefined,
    codeExec: params.featureFlags?.codeExec || undefined,
  };
}

/**
 * Resolves the model id used for a chat request.
 *
 * Route-aware policy sourced from ModelList + runtime capability checks.
 */
export async function resolveModelForRequestDetailed(
  params: ResolveModelParams,
): Promise<ModelResolutionDetails> {
  const route = (params.route ?? 'chat').toLowerCase();
  const baseCandidates = buildBaseCandidateChain(params);
  const allowed = applyAllowedModels(baseCandidates, params.allowedModels);
  const candidates = rankByHealth(allowed.candidates);
  const requirements = buildRequirements(params);
  const decisions: ModelCandidateDecision[] = [];

  if (allowed.allowlistApplied && allowed.allowedSet) {
    for (const candidate of baseCandidates) {
      if (!allowed.allowedSet.has(candidate)) {
        decisions.push({
          model: candidate,
          accepted: false,
          reason: 'allowlist_filtered',
          healthScore: getModelHealthScore(candidate),
        });
      }
    }
  }

  for (const candidate of candidates) {
    const lookup = await findModelInCatalog(candidate, { refreshIfMissing: false });
    if (!lookup.model) {
      // Unknown model ids can still be valid aliases on the provider side.
      decisions.push({
        model: candidate,
        accepted: true,
        reason: 'catalog_miss_accept_unknown',
        healthScore: getModelHealthScore(candidate),
      });
      return {
        model: candidate,
        route,
        requirements,
        allowlistApplied: allowed.allowlistApplied,
        candidates,
        decisions,
      };
    }

    if (modelSupports(lookup.model, requirements)) {
      decisions.push({
        model: candidate,
        accepted: true,
        reason: 'selected',
        healthScore: getModelHealthScore(candidate),
      });
      return {
        model: candidate,
        route,
        requirements,
        allowlistApplied: allowed.allowlistApplied,
        candidates,
        decisions,
      };
    }

    decisions.push({
      model: candidate,
      accepted: false,
      reason: 'capability_mismatch',
      healthScore: getModelHealthScore(candidate),
    });
  }

  const fallback = candidates[0] ?? getDefaultModelId();
  decisions.push({
    model: fallback,
    accepted: true,
    reason: 'fallback_first_candidate',
    healthScore: getModelHealthScore(fallback),
  });

  return {
    model: fallback,
    route,
    requirements,
    allowlistApplied: allowed.allowlistApplied,
    candidates,
    decisions,
  };
}

export async function resolveModelForRequest(params: ResolveModelParams): Promise<string> {
  const details = await resolveModelForRequestDetailed(params);
  return details.model;
}
