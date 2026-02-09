import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideAgent } from '../../../src/core/orchestration/agentSelector';

const mockChat = vi.hoisted(() => vi.fn());

vi.mock('../../../src/core/llm', () => ({
  createLLMClient: () => ({
    chat: mockChat,
  }),
}));

vi.mock('../../../src/core/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('agentSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('supports kind alias and string temperature in selector JSON', async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify({
        kind: 'coding',
        reasoning: 'User asked for code changes.',
        temperature: '0.4',
      }),
    });

    const decision = await decideAgent({
      userText: 'Please write a TypeScript parser.',
      invokedBy: 'mention',
      hasGuild: true,
      conversationHistory: [],
      replyReferenceContent: null,
      apiKey: 'api-key',
    });

    expect(decision.kind).toBe('coding');
    expect(decision.allowTools).toBe(true);
    expect(decision.temperature).toBeCloseTo(0.4);
  });

  it('clamps chat temperature to minimum 1.0 when selector returns lower value', async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify({
        agent: 'chat',
        reasoning: 'General conversation request.',
        temperature: 0.2,
      }),
    });

    const decision = await decideAgent({
      userText: 'let us chat casually',
      invokedBy: 'mention',
      hasGuild: true,
      conversationHistory: [],
      replyReferenceContent: null,
      apiKey: 'api-key',
    });

    expect(decision.kind).toBe('chat');
    expect(decision.temperature).toBe(1.0);
  });

  it('clamps chat temperature to maximum 1.4 when selector returns higher value', async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify({
        agent: 'chat',
        reasoning: 'Creative chat request.',
        temperature: 1.49,
      }),
    });

    const decision = await decideAgent({
      userText: 'tell me a vivid and imaginative story',
      invokedBy: 'mention',
      hasGuild: true,
      conversationHistory: [],
      replyReferenceContent: null,
      apiKey: 'api-key',
    });

    expect(decision.kind).toBe('chat');
    expect(decision.temperature).toBe(1.4);
  });

  it('routes guild command invocations directly to chat without LLM', async () => {
    const decision = await decideAgent({
      userText: '/sage settings',
      invokedBy: 'command',
      hasGuild: true,
      conversationHistory: [],
      replyReferenceContent: null,
      apiKey: 'api-key',
    });

    expect(decision.kind).toBe('chat');
    expect(decision.allowTools).toBe(true);
    expect(decision.temperature).toBe(1.2);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('falls back to default chat decision when response is not parseable', async () => {
    mockChat.mockResolvedValue({
      content: 'this is not valid json',
    });

    const decision = await decideAgent({
      userText: 'hello there',
      invokedBy: 'mention',
      hasGuild: true,
      conversationHistory: [],
      replyReferenceContent: null,
      apiKey: 'api-key',
    });

    expect(decision.kind).toBe('chat');
    expect(decision.temperature).toBe(1.2);
  });
});
