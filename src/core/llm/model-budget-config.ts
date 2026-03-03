/**
 * @module src/core/llm/model-budget-config
 * @description Defines the model budget config module.
 */
import { config } from '../../config';
import { logger } from '../utils/logger';
import { ModelLimits, TokenEstimateOptions } from './context-budgeter';

/**
 * Represents the ModelBudgetConfig type.
 */
export type ModelBudgetConfig = ModelLimits & {
  estimation: TokenEstimateOptions;
  attachmentTextMaxTokens: number;
  visionFadeKeepLastUserImages: number;
};

const DEFAULT_SAFETY_MARGIN = 200;
const DEFAULT_IMAGE_TOKENS = 1200;
const DEFAULT_MESSAGE_OVERHEAD = 4;
const DEFAULT_ATTACHMENT_MAX_TOKENS = Math.floor(config.CONTEXT_USER_MAX_TOKENS * 0.4);

const BASE_ESTIMATION: TokenEstimateOptions = {
  charsPerToken: config.TOKEN_HEURISTIC_CHARS_PER_TOKEN,
  codeCharsPerToken: Math.max(3, config.TOKEN_HEURISTIC_CHARS_PER_TOKEN - 0.5),
  imageTokens: DEFAULT_IMAGE_TOKENS,
  messageOverheadTokens: DEFAULT_MESSAGE_OVERHEAD,
};

const BASE_LIMITS: ModelBudgetConfig = {
  model: 'default',
  maxContextTokens: config.CONTEXT_MAX_INPUT_TOKENS,
  maxOutputTokens: config.CONTEXT_RESERVED_OUTPUT_TOKENS,
  safetyMarginTokens: DEFAULT_SAFETY_MARGIN,
  visionEnabled: true,
  estimation: BASE_ESTIMATION,
  attachmentTextMaxTokens: DEFAULT_ATTACHMENT_MAX_TOKENS,
  visionFadeKeepLastUserImages: 1,
};

const BUILTIN_MODEL_OVERRIDES: Record<string, Partial<ModelBudgetConfig>> = {
  kimi: {
    visionEnabled: true,
  },
  deepseek: {
    visionEnabled: false,
  },
};

function normalizeModelName(model?: string): string {
  return (model ?? 'default').trim().toLowerCase() || 'default';
}

function parseModelOverridesFromEnv(): Record<string, Partial<ModelBudgetConfig>> {
  const raw = config.LLM_MODEL_LIMITS_JSON?.trim();
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<ModelBudgetConfig>>;
    return parsed ?? {};
  } catch (error) {
    logger.warn({ error }, 'Failed to parse LLM_MODEL_LIMITS_JSON overrides');
    return {};
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
    attachmentTextMaxTokens:
      override?.attachmentTextMaxTokens ?? base.attachmentTextMaxTokens,
    visionFadeKeepLastUserImages:
      override?.visionFadeKeepLastUserImages ?? base.visionFadeKeepLastUserImages,
  };
}

/**
 * Runs getModelBudgetConfig.
 *
 * @param model - Describes the model input.
 * @returns Returns the function result.
 */
export function getModelBudgetConfig(model?: string): ModelBudgetConfig {
  const normalized = normalizeModelName(model);
  const envOverrides = parseModelOverridesFromEnv();

  const configOverride = {
    ...BUILTIN_MODEL_OVERRIDES[normalized],
    ...envOverrides[normalized],
  };

  const merged = mergeConfig({ ...BASE_LIMITS, model: normalized }, configOverride);

  return merged;
}
