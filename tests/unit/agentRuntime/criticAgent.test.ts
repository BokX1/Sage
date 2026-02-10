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
      routeKind: 'chat',
      userText: 'Explain X',
      draftText: 'Answer',
      apiKey: 'key',
    });

    expect(result).not.toBeNull();
    expect(result?.score).toBe(0.82);
    expect(result?.verdict).toBe('pass');
    expect(result?.model).toBe('deepseek');
  });

  it('extracts valid JSON when wrapped in extra text or code fences', async () => {
    mockChat.mockResolvedValue({
      content:
        'Here is my assessment:\\n```json\\n' +
        JSON.stringify({
          score: 0.91,
          verdict: 'pass',
          issues: [],
          rewritePrompt: '',
        }) +
        '\\n```\\nThanks.',
    });

    const result = await evaluateDraftWithCritic({
      guildId: 'guild-1',
      routeKind: 'chat',
      userText: 'Explain X',
      draftText: 'Answer',
      apiKey: 'key',
    });

    expect(result).not.toBeNull();
    expect(result?.score).toBe(0.91);
    expect(result?.verdict).toBe('pass');
  });

  it('parses JSON with a trailing comma (lenient parse)', async () => {
    mockChat.mockResolvedValue({
      content:
        '{' +
        '\"score\": 0.8,' +
        '\"verdict\": \"pass\",' +
        '\"issues\": [],' +
        '\"rewritePrompt\": \"\",' +
        '}', // trailing comma after issues should be tolerated by lenient parser above
    });

    const result = await evaluateDraftWithCritic({
      guildId: 'guild-1',
      routeKind: 'chat',
      userText: 'Explain X',
      draftText: 'Answer',
      apiKey: 'key',
    });

    expect(result).not.toBeNull();
    expect(result?.verdict).toBe('pass');
  });

  it('returns null for invalid JSON', async () => {
    mockChat.mockResolvedValue({
      content: 'not json',
    });

    const result = await evaluateDraftWithCritic({
      guildId: 'guild-1',
      routeKind: 'chat',
      userText: 'Explain X',
      draftText: 'Answer',
    });

    expect(result).toBeNull();
  });

  it('uses coding-specific critic prompt for coding route', async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify({
        score: 0.6,
        verdict: 'revise',
        issues: ['Missing edge case'],
        rewritePrompt: 'Handle invalid input explicitly.',
      }),
    });

    await evaluateDraftWithCritic({
      guildId: 'guild-1',
      routeKind: 'coding',
      userText: 'Write a parser',
      draftText: 'function parse() {}',
    });

    const request = mockChat.mock.calls[0]?.[0] as { messages: Array<{ content: string }> };
    expect(request.messages[0].content).toContain('code-quality critic');
    expect(request.messages[0].content).toContain('missing imports/dependencies');
    expect(request.messages[0].content).toContain('Do NOT require unrelated hardening extras');
  });

  it('uses search-specific critic prompt for search route', async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify({
        score: 0.55,
        verdict: 'revise',
        issues: ['No source cues'],
        rewritePrompt: 'Add domain-level citations.',
      }),
    });

    await evaluateDraftWithCritic({
      guildId: 'guild-1',
      routeKind: 'search',
      userText: 'What is the latest Node.js LTS?',
      draftText: 'Node.js LTS is 20.',
    });

    const request = mockChat.mock.calls[0]?.[0] as { messages: Array<{ content: string }> };
    expect(request.messages[0].content).toContain('search-routed');
    expect(request.messages[0].content).toContain('Checked on');
    expect(request.messages[0].content).toContain('source URL');
  });

  it('serializes non-text chat history content in critic payload', async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify({
        score: 0.9,
        verdict: 'pass',
        issues: [],
        rewritePrompt: '',
      }),
    });

    await evaluateDraftWithCritic({
      guildId: 'guild-1',
      routeKind: 'chat',
      userText: 'thoughts?',
      draftText: 'Looks good.',
      conversationHistory: [
        {
          role: 'assistant',
          content: [{ type: 'image_url', image_url: { url: 'https://example.com/cat.png' } }],
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Nice image' }],
        },
      ],
    });

    const request = mockChat.mock.calls[0]?.[0] as { messages: Array<{ content: string }> };
    expect(request.messages[1].content).toContain('assistant: [image]');
    expect(request.messages[1].content).toContain('user: Nice image');
  });
});
