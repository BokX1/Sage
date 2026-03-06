/**
 * @description Validates attachment parser budget normalization behavior.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
  CONTEXT_USER_MAX_TOKENS: 8000,
  TOKEN_HEURISTIC_CHARS_PER_TOKEN: 4,
}));

const mockEstimateTokens = vi.hoisted(() => vi.fn(() => 0));
const mockIsPrivateOrLocalHostname = vi.hoisted(() => vi.fn(() => false));

vi.mock('@/platform/config/env', () => ({
  config: mockConfig,
  isPrivateOrLocalHostname: mockIsPrivateOrLocalHostname,
}));

vi.mock('@/features/agent-runtime/tokenEstimate', () => ({
  estimateTokens: mockEstimateTokens,
}));

import {
  deriveAttachmentBudget,
  getVisionImageUrl,
} from '../../../../../src/app/discord/handlers/attachment-parser';

function createMockMessage(overrides: Record<string, unknown> = {}) {
  return {
    content: '',
    attachments: {
      first: vi.fn(() => null),
      values: vi.fn(() => []),
    },
    ...overrides,
  };
}

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

describe('attachment-parser getVisionImageUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPrivateOrLocalHostname.mockReturnValue(false);
  });

  it('uses sticker URLs as vision input when available', () => {
    const message = createMockMessage({
      stickers: {
        values: vi.fn(() => [
          { url: 'https://media.discordapp.net/stickers/example.webp' },
        ]),
      },
    });

    expect(getVisionImageUrl(message as unknown as Parameters<typeof getVisionImageUrl>[0])).toBe(
      'https://media.discordapp.net/stickers/example.webp',
    );
  });

  it('trims trailing punctuation from direct image URLs in message content', () => {
    const message = createMockMessage({
      content: 'look at this https://example.com/direct.png.',
    });

    expect(getVisionImageUrl(message as unknown as Parameters<typeof getVisionImageUrl>[0])).toBe(
      'https://example.com/direct.png',
    );
  });
});
