import { encodingForModel, getEncoding, getEncodingNameForModel } from 'js-tiktoken';
import { config } from '../config/env';
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

export type TokenCountSource = 'local_tokenizer' | 'fallback_estimator';
export type TokenEstimateOptions = Record<string, never>;

export type TokenCountResult = {
  totalTokens: number;
  source: TokenCountSource;
  encodingName: string;
  imageTokenReserve: number;
};

const DEFAULT_IMAGE_TOKEN_RESERVE = 1_200;
const DEFAULT_FALLBACK_ENCODING = 'o200k_base' as const;
const DEFAULT_MESSAGE_OVERHEAD_TOKENS = 4;
const encoderCache = new Map<string, ReturnType<typeof getEncoding>>();

function normalizeModelName(model: string): string {
  return model.trim().toLowerCase();
}

function resolveEncodingName(model: string): Parameters<typeof getEncoding>[0] {
  const normalizedModel = normalizeModelName(model);
  try {
    return getEncodingNameForModel(normalizedModel as Parameters<typeof getEncodingNameForModel>[0]);
  } catch {
    return DEFAULT_FALLBACK_ENCODING;
  }
}

function getTokenizer(model: string): {
  encodingName: Parameters<typeof getEncoding>[0];
  encoder: ReturnType<typeof getEncoding>;
  source: TokenCountSource;
} {
  const encodingName = resolveEncodingName(model);
  const cached = encoderCache.get(encodingName);
  if (cached) {
    return {
      encodingName,
      encoder: cached,
      source: encodingName === DEFAULT_FALLBACK_ENCODING ? 'fallback_estimator' : 'local_tokenizer',
    };
  }

  let encoder: ReturnType<typeof getEncoding>;
  if (encodingName === DEFAULT_FALLBACK_ENCODING) {
    encoder = getEncoding(DEFAULT_FALLBACK_ENCODING);
  } else {
    try {
      encoder = encodingForModel(normalizeModelName(model) as Parameters<typeof encodingForModel>[0]);
    } catch {
      encoder = getEncoding(encodingName);
    }
  }
  encoderCache.set(encodingName, encoder);
  return {
    encodingName,
    encoder,
    source: encodingName === DEFAULT_FALLBACK_ENCODING ? 'fallback_estimator' : 'local_tokenizer',
  };
}

function countTextTokens(text: string, encoder: ReturnType<typeof getEncoding>): number {
  if (!text) {
    return 0;
  }
  return encoder.encode(text).length;
}

export function countMessageTokens(
  message: LLMChatMessage,
  model: string,
): TokenCountResult {
  const { encodingName, encoder, source } = getTokenizer(model);
  let totalTokens = DEFAULT_MESSAGE_OVERHEAD_TOKENS;
  let imageTokenReserve = 0;

  if (typeof message.content === 'string') {
    totalTokens += countTextTokens(message.content, encoder);
  } else {
    for (const part of message.content) {
      if (part.type === 'text') {
        totalTokens += countTextTokens(part.text, encoder);
      } else if (part.type === 'image_url') {
        totalTokens += DEFAULT_IMAGE_TOKEN_RESERVE;
        imageTokenReserve += DEFAULT_IMAGE_TOKEN_RESERVE;
      }
    }
  }

  if (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
    totalTokens += countTextTokens(JSON.stringify(message.toolCalls), encoder);
  }
  if (message.toolCallId) {
    totalTokens += countTextTokens(message.toolCallId, encoder);
  }

  return {
    totalTokens,
    source,
    encodingName,
    imageTokenReserve,
  };
}

export function countMessagesTokens(
  messages: LLMChatMessage[],
  model: string,
): TokenCountResult {
  let totalTokens = 0;
  let imageTokenReserve = 0;
  let encodingName: string = DEFAULT_FALLBACK_ENCODING;
  let source: TokenCountSource = 'local_tokenizer';

  for (const message of messages) {
    const result = countMessageTokens(message, model);
    totalTokens += result.totalTokens;
    imageTokenReserve += result.imageTokenReserve;
    encodingName = result.encodingName;
    if (result.source === 'fallback_estimator') {
      source = 'fallback_estimator';
    }
  }

  return {
    totalTokens,
    source,
    encodingName,
    imageTokenReserve,
  };
}

function resolveDefaultModel(candidate?: string): string {
  return candidate?.trim() || config.AI_PROVIDER_MAIN_AGENT_MODEL;
}

export function estimateTextTokens(
  text: string,
  _opts?: TokenEstimateOptions,
  model?: string,
): number {
  return countMessageTokens(
    {
      role: 'user',
      content: text,
    },
    resolveDefaultModel(model),
  ).totalTokens;
}

export function estimateMessageTokens(
  message: LLMChatMessage,
  optsOrModel?: TokenEstimateOptions | string,
  maybeModel?: string,
): number {
  const model = typeof optsOrModel === 'string' ? optsOrModel : maybeModel;
  return countMessageTokens(message, resolveDefaultModel(model)).totalTokens;
}

export function estimateMessagesTokens(
  messages: LLMChatMessage[],
  optsOrModel?: TokenEstimateOptions | string,
  maybeModel?: string,
): number {
  const model = typeof optsOrModel === 'string' ? optsOrModel : maybeModel;
  return countMessagesTokens(messages, resolveDefaultModel(model)).totalTokens;
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
