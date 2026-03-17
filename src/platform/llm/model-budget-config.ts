import { config } from '../config/env';
import { logger } from '../logging/logger';
import { ModelLimits, TokenEstimateOptions } from './context-budgeter';

/**
 * Represents the ModelBudgetConfig type.
 */
export type ModelBudgetConfig = ModelLimits & {
  estimation: TokenEstimateOptions;
};

const DEFAULT_SAFETY_MARGIN = 1024;
const DEFAULT_IMAGE_TOKENS = 1200;
const DEFAULT_MESSAGE_OVERHEAD = 4;

const BASE_ESTIMATION: TokenEstimateOptions = {
  charsPerToken: config.TOKEN_HEURISTIC_CHARS_PER_TOKEN,
  codeCharsPerToken: Math.max(3, config.TOKEN_HEURISTIC_CHARS_PER_TOKEN - 0.5),
  imageTokens: DEFAULT_IMAGE_TOKENS,
  messageOverheadTokens: DEFAULT_MESSAGE_OVERHEAD,
};

const BASE_LIMITS: Omit<ModelBudgetConfig, 'model'> = {
  maxContextTokens: config.CONTEXT_MAX_INPUT_TOKENS,
  maxOutputTokens: config.CONTEXT_RESERVED_OUTPUT_TOKENS,
  safetyMarginTokens: DEFAULT_SAFETY_MARGIN,
  visionEnabled: true,
  estimation: BASE_ESTIMATION,
};

function normalizeModelName(model?: string): string {
  return (model ?? '').trim().toLowerCase();
}

type RawModelProfile = Partial<Omit<ModelBudgetConfig, 'model'>>;

let cachedProfilesJson: string | null = null;
let cachedProfiles: Record<string, RawModelProfile> | null = null;

function parseModelOverridesFromEnv(): Record<string, RawModelProfile> {
  const raw = config.AI_PROVIDER_MODEL_PROFILES_JSON?.trim() ?? '';
  if (cachedProfiles && cachedProfilesJson === raw) {
    return cachedProfiles;
  }

  if (!raw) {
    cachedProfilesJson = raw;
    cachedProfiles = {};
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, RawModelProfile>;
    const normalizedEntries = Object.entries(parsed ?? {}).map(([modelId, profile]) => [
      normalizeModelName(modelId),
      profile ?? {},
    ]);
    cachedProfilesJson = raw;
    cachedProfiles = Object.fromEntries(normalizedEntries);
    return cachedProfiles ?? {};
  } catch (error) {
    logger.error({ error }, 'Failed to parse AI_PROVIDER_MODEL_PROFILES_JSON overrides');
    throw new Error('AI_PROVIDER_MODEL_PROFILES_JSON must be valid JSON keyed by model id.', {
      cause: error,
    });
  }
}

function mergeEstimation(
  base: TokenEstimateOptions,
  override?: Partial<TokenEstimateOptions>,
): TokenEstimateOptions {
  return {
    charsPerToken: override?.charsPerToken ?? base.charsPerToken,
    codeCharsPerToken: override?.codeCharsPerToken ?? base.codeCharsPerToken,
    imageTokens: override?.imageTokens ?? base.imageTokens,
    messageOverheadTokens: override?.messageOverheadTokens ?? base.messageOverheadTokens,
  };
}

function mergeConfig(
  base: ModelBudgetConfig,
  override?: Partial<ModelBudgetConfig>,
): ModelBudgetConfig {
  return {
    ...base,
    ...override,
    estimation: mergeEstimation(base.estimation, override?.estimation),
  };
}

export function getModelBudgetConfig(model?: string): ModelBudgetConfig {
  const normalized = normalizeModelName(model);
  if (!normalized) {
    throw new Error('A model id is required to resolve AI provider model budgets.');
  }
  const envOverrides = parseModelOverridesFromEnv();
  const profile = envOverrides[normalized];
  const merged = mergeConfig({ ...BASE_LIMITS, model: normalized }, profile);

  return merged;
}
