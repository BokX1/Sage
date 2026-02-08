import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateDraftWithCritic } from '../../../src/core/agentRuntime/criticAgent';

const mockChat = vi.hoisted(() => vi.fn());
const mockResolveModelForRequest = vi.hoisted(() => vi.fn());

vi.mock('../../../src/core/llm', () => ({
  getLLMClient: () => ({ chat: mockChat }),
}));

vi.mock('../../../src/core/llm/model-resolver', () => ({
  resolveModelForRequest: mockResolveModelForRequest,
}));

vi.mock('../../../src/core/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('criticAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveModelForRequest.mockResolvedValue('deepseek');
  });

  it('parses valid critic JSON responses', async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify({
        score: 0.82,
        verdict: 'pass',
        issues: ['minor clarity'],
        rewritePrompt: 'tighten structure',
      }),
    });

    const result = await evaluateDraftWithCritic({
      guildId: 'guild-1',
      routeKind: 'qa',
      userText: 'Explain X',
      draftText: 'Answer',
      apiKey: 'key',
    });

    expect(result).not.toBeNull();
    expect(result?.score).toBe(0.82);
    expect(result?.verdict).toBe('pass');
    expect(result?.model).toBe('deepseek');
  });

  it('returns null for invalid JSON', async () => {
    mockChat.mockResolvedValue({
      content: 'not json',
    });

    const result = await evaluateDraftWithCritic({
      guildId: 'guild-1',
      routeKind: 'qa',
      userText: 'Explain X',
      draftText: 'Answer',
    });

    expect(result).toBeNull();
  });
});
