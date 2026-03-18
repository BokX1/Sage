import { describe, expect, it } from 'vitest';
import type { LLMChatMessage } from '@/platform/llm/llm-types';
import {
  estimateMessageTokens,
  estimateMessagesTokens,
  planBudget,
} from '@/platform/llm/context-budgeter';

const limits = {
  model: 'test-model',
  maxContextTokens: 80,
  maxOutputTokens: 10,
  safetyMarginTokens: 0,
  visionEnabled: true,
};

describe('budgeter', () => {
  it('computes available input tokens from model limits and reserved output', () => {
    const plan = planBudget(limits, { reservedOutputTokens: 15 });
    expect(plan.availableInputTokens).toBe(65);
    expect(plan.reservedOutputTokens).toBe(15);
  });

  it('estimation remains monotonic as message content grows', () => {
    const shortMsg: LLMChatMessage = { role: 'user', content: 'hello' };
    const longMsg: LLMChatMessage = { role: 'user', content: 'hello world, this is longer' };

    expect(estimateMessageTokens(longMsg, 'gpt-4o-mini')).toBeGreaterThanOrEqual(
      estimateMessageTokens(shortMsg, 'gpt-4o-mini'),
    );
    expect(estimateMessagesTokens([shortMsg, longMsg], 'gpt-4o-mini')).toBe(
      estimateMessageTokens(shortMsg, 'gpt-4o-mini') + estimateMessageTokens(longMsg, 'gpt-4o-mini'),
    );
  });
});
