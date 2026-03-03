/**
 * @description Validates attachment parser budget normalization behavior.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  CONTEXT_USER_MAX_TOKENS: 8000,
  TOKEN_HEURISTIC_CHARS_PER_TOKEN: 4,
}));

const mockEstimateTokens = vi.hoisted(() => vi.fn(() => 0));

vi.mock('../../../src/config', () => ({
  config: mockConfig,
}));

vi.mock('../../../src/core/agentRuntime/tokenEstimate', () => ({
  estimateTokens: mockEstimateTokens,
}));

import { deriveAttachmentBudget } from '../../../src/bot/handlers/attachment-parser';

describe('attachment-parser deriveAttachmentBudget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.CONTEXT_USER_MAX_TOKENS = 8000;
    mockConfig.TOKEN_HEURISTIC_CHARS_PER_TOKEN = 4;
    mockEstimateTokens.mockReturnValue(0);
  });

  it('derives budget from finite config values', () => {
    mockConfig.CONTEXT_USER_MAX_TOKENS = 1000;
    mockConfig.TOKEN_HEURISTIC_CHARS_PER_TOKEN = 4;
    mockEstimateTokens.mockReturnValue(100);

    const budget = deriveAttachmentBudget({ baseText: 'hello' });

    expect(budget).toEqual({
      maxChars: 3600,
      maxBytes: 14_400,
    });
  });

  it('falls back safely when config values are non-finite', () => {
    mockConfig.CONTEXT_USER_MAX_TOKENS = Number.NaN as unknown as number;
    mockConfig.TOKEN_HEURISTIC_CHARS_PER_TOKEN = Number.NaN as unknown as number;
    mockEstimateTokens.mockReturnValue(50);

    const budget = deriveAttachmentBudget({ baseText: 'hello' });

    expect(budget).toEqual({
      maxChars: 0,
      maxBytes: 0,
    });
  });

  it('enforces minimum chars-per-token of one', () => {
    mockConfig.CONTEXT_USER_MAX_TOKENS = 10;
    mockConfig.TOKEN_HEURISTIC_CHARS_PER_TOKEN = 0;
    mockEstimateTokens.mockReturnValue(5);

    const budget = deriveAttachmentBudget({ baseText: 'hello' });

    expect(budget).toEqual({
      maxChars: 5,
      maxBytes: 20,
    });
  });
});
