import { LLMChatMessage } from './llm-types';

export type ModelLimits = {
  model: string;
  maxContextTokens: number;
  maxOutputTokens: number;
  safetyMarginTokens: number;
  visionEnabled?: boolean;
};

export type BudgetPlan = {
  limits: ModelLimits;
  reservedOutputTokens: number;
  availableInputTokens: number;
};

export type TokenEstimateOptions = {
  charsPerToken: number;
  codeCharsPerToken: number;
  imageTokens: number;
  messageOverheadTokens: number;
};

const DEFAULT_TOKEN_ESTIMATOR: TokenEstimateOptions = {
  charsPerToken: 4,
  codeCharsPerToken: 3.5,
  imageTokens: 1200,
  messageOverheadTokens: 4,
};

function isLikelyCodeOrJson(text: string): boolean {
  if (text.includes('```')) {
    return true;
  }

  const trimmed = text.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return true;
  }

  const nonWordMatches = text.match(/[^A-Za-z0-9\s]/g) ?? [];
  const density = text.length > 0 ? nonWordMatches.length / text.length : 0;
  return density >= 0.3;
}

export function estimateTextTokens(text: string, opts?: TokenEstimateOptions): number {
  const estimator = opts ?? DEFAULT_TOKEN_ESTIMATOR;
  const ratio = isLikelyCodeOrJson(text) ? estimator.codeCharsPerToken : estimator.charsPerToken;
  if (ratio <= 0) {
    return text.length;
  }
  return Math.ceil(text.length / ratio);
}

export function estimateMessageTokens(
  message: LLMChatMessage,
  opts?: TokenEstimateOptions,
): number {
  const estimator = opts ?? DEFAULT_TOKEN_ESTIMATOR;
  if (typeof message.content === 'string') {
    return estimateTextTokens(message.content, estimator) + estimator.messageOverheadTokens;
  }

  let total = estimator.messageOverheadTokens;
  for (const part of message.content) {
    if (part.type === 'text') {
      total += estimateTextTokens(part.text, estimator);
    } else if (part.type === 'image_url') {
      total += estimator.imageTokens;
    }
  }
  return total;
}

export function estimateMessagesTokens(
  messages: LLMChatMessage[],
  opts?: TokenEstimateOptions,
): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message, opts), 0);
}

export function planBudget(
  limits: ModelLimits,
  opts?: { reservedOutputTokens?: number },
): BudgetPlan {
  const reservedOutputTokens = Math.max(
    0,
    opts?.reservedOutputTokens ?? limits.maxOutputTokens,
  );
  const availableInputTokens = Math.max(
    0,
    limits.maxContextTokens - reservedOutputTokens - limits.safetyMarginTokens,
  );

  return {
    limits,
    reservedOutputTokens,
    availableInputTokens,
  };
}
