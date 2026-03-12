import type { LLMChatMessage, LLMRequest } from '../../../platform/llm/llm-types';
import { getModelBudgetConfig } from '../../../platform/llm/model-budget-config';
import { planBudget, trimMessagesToBudget } from '../../../platform/llm/context-budgeter';
import type { GraphRebudgetEvent } from './types';

export function buildRebudgetingEvent(
  messages: LLMChatMessage[],
  model: string | undefined,
  maxTokens: number | undefined,
): { trimmedMessages: LLMChatMessage[]; rebudgeting: GraphRebudgetEvent } {
  const modelConfig = getModelBudgetConfig(model);
  const budgetPlan = planBudget(modelConfig, {
    reservedOutputTokens: maxTokens ?? modelConfig.maxOutputTokens,
  });
  const { trimmed, stats } = trimMessagesToBudget(messages, budgetPlan, {
    keepSystemMessages: true,
    keepLastUserTurns: 4,
    visionFadeKeepLastUserImages: modelConfig.visionFadeKeepLastUserImages,
    attachmentTextMaxTokens: modelConfig.attachmentTextMaxTokens,
    estimator: modelConfig.estimation,
    visionEnabled: modelConfig.visionEnabled,
  });

  return {
    trimmedMessages: trimmed,
    rebudgeting: {
      beforeCount: stats.beforeCount,
      afterCount: stats.afterCount,
      estimatedTokensBefore: stats.estimatedTokensBefore,
      estimatedTokensAfter: stats.estimatedTokensAfter,
      availableInputTokens: budgetPlan.availableInputTokens,
      reservedOutputTokens: budgetPlan.reservedOutputTokens,
      notes: [...stats.notes],
      trimmed:
        stats.beforeCount !== stats.afterCount ||
        stats.estimatedTokensBefore !== stats.estimatedTokensAfter ||
        stats.notes.length > 0,
    },
  };
}

export function buildGraphChatRequest(params: {
  messages: LLMChatMessage[];
  model?: string;
  apiKey?: string;
  temperature: number;
  timeoutMs?: number;
  maxTokens?: number;
  tools?: LLMRequest['tools'];
  toolChoice?: LLMRequest['toolChoice'];
}): { request: LLMRequest; rebudgeting: GraphRebudgetEvent } {
  const { trimmedMessages, rebudgeting } = buildRebudgetingEvent(
    params.messages,
    params.model,
    params.maxTokens,
  );

  return {
    request: {
      messages: trimmedMessages,
      model: params.model,
      apiKey: params.apiKey,
      temperature: params.temperature,
      timeout: params.timeoutMs,
      maxTokens: params.maxTokens,
      tools: params.tools,
      toolChoice: params.toolChoice,
    },
    rebudgeting,
  };
}
