/**
 * @module tests/unit/summary/summarizeChannelWindow.pipeline.test
 * @description Defines the summarize channel window.pipeline.test module.
 */
import type { ChannelMessage } from '@/core/awareness/awareness-types';
import type { LLMRequest, LLMResponse } from '@/core/llm/llm-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockChatFn = vi.hoisted(() => vi.fn<(request: LLMRequest) => Promise<LLMResponse>>());

vi.mock('@/core/llm', () => ({
  getLLMClient: () => ({
    chat: mockChatFn,
  }),
  createLLMClient: () => ({
    chat: mockChatFn,
  }),
}));

vi.mock('@/config', () => ({
  config: {
    SUMMARY_MODEL: 'deepseek',
  },
}));

let messageCounter = 0;

function makeMessage(content: string, author = 'TestUser'): ChannelMessage {
  messageCounter += 1;
  return {
    messageId: `msg-${messageCounter}`,
    guildId: 'G1',
    channelId: 'C1',
    authorId: 'U1',
    authorDisplayName: author,
    authorIsBot: false,
    timestamp: new Date('2026-01-15T12:00:00.000Z'),
    content,
    mentionsUserIds: [],
    mentionsBot: false,
  };
}

describe('summarizeChannelWindow pipeline', () => {
  beforeEach(() => {
    vi.resetModules();
    mockChatFn.mockReset();
    messageCounter = 0;
  });

  it('parses valid JSON analyst output into StructuredSummary', async () => {
    const { summarizeChannelWindow } = await import('@/core/summary/summarizeChannelWindow');

    const mockJson = JSON.stringify({
      summaryText: 'The team discussed the new API design.',
      topics: ['API design', 'authentication'],
      threads: ['Backend refactor'],
      decisions: ['Use JWT for auth'],
      actionItems: ['@Alice: Write the auth middleware (Deadline: Friday)'],
      sentiment: 'Productive',
      unresolved: ['Rate limiting strategy'],
      glossary: { JWT: 'JSON Web Token' },
    });

    mockChatFn.mockResolvedValueOnce({ content: mockJson });

    const result = await summarizeChannelWindow({
      messages: [makeMessage('Let us discuss the API')],
      windowStart: new Date('2026-01-15T11:00:00.000Z'),
      windowEnd: new Date('2026-01-15T13:00:00.000Z'),
    });

    expect(result.summaryText).toBe('The team discussed the new API design.');
    expect(result.topics).toEqual(['API design', 'authentication']);
    expect(result.decisions).toEqual(['Use JWT for auth']);
    expect(result.actionItems).toEqual(['@Alice: Write the auth middleware (Deadline: Friday)']);
    expect(result.sentiment).toBe('Productive');
    expect(result.glossary).toEqual({ JWT: 'JSON Web Token' });
  });

  it('enforces responseFormat json_object in analyst payload', async () => {
    const { summarizeChannelWindow } = await import('@/core/summary/summarizeChannelWindow');

    mockChatFn.mockResolvedValueOnce({
      content: JSON.stringify({ summaryText: 'Test', topics: [] }),
    });

    await summarizeChannelWindow({
      messages: [makeMessage('Hello')],
      windowStart: new Date('2026-01-15T11:00:00.000Z'),
      windowEnd: new Date('2026-01-15T13:00:00.000Z'),
    });

    expect(mockChatFn).toHaveBeenCalledTimes(1);
    const payload = mockChatFn.mock.calls[0][0];
    expect(payload.responseFormat).toBe('json_object');
    expect(payload.maxTokens).toBe(2048);
  });

  it('falls back when analyst returns empty', async () => {
    const { summarizeChannelWindow } = await import('@/core/summary/summarizeChannelWindow');

    mockChatFn.mockResolvedValueOnce({ content: '' });

    const result = await summarizeChannelWindow({
      messages: [makeMessage('Test message')],
      windowStart: new Date('2026-01-15T11:00:00.000Z'),
      windowEnd: new Date('2026-01-15T13:00:00.000Z'),
    });

    expect(result.summaryText).toBeTruthy();
    expect(result.topics).toEqual([]);
  });

  it('falls back when analyst returns invalid JSON', async () => {
    const { summarizeChannelWindow } = await import('@/core/summary/summarizeChannelWindow');

    mockChatFn.mockResolvedValueOnce({
      content: 'This is not JSON at all, just text.',
    });

    const result = await summarizeChannelWindow({
      messages: [makeMessage('Hello world')],
      windowStart: new Date('2026-01-15T11:00:00.000Z'),
      windowEnd: new Date('2026-01-15T13:00:00.000Z'),
    });

    expect(result.summaryText).toBeTruthy();
  });
});

describe('summarizeChannelProfile pipeline', () => {
  beforeEach(() => {
    vi.resetModules();
    mockChatFn.mockReset();
  });

  it('parses valid JSON analyst output for LTM profile', async () => {
    const { summarizeChannelProfile } = await import('@/core/summary/summarizeChannelWindow');

    const mockJson = JSON.stringify({
      summaryText: 'This channel is focused on backend development.',
      topics: ['backend', 'databases'],
      threads: ['Migration to PostgreSQL'],
      decisions: ['Adopted Prisma ORM'],
      actionItems: ['@Bob: Set up pgvector'],
      sentiment: 'Collaborative',
      unresolved: ['Sharding strategy'],
      glossary: { ORM: 'Object-Relational Mapping' },
    });

    mockChatFn.mockResolvedValueOnce({ content: mockJson });

    const result = await summarizeChannelProfile({
      previousSummary: null,
      latestRollingSummary: {
        windowStart: new Date('2026-01-15T11:00:00.000Z'),
        windowEnd: new Date('2026-01-15T13:00:00.000Z'),
        summaryText: 'Discussed migration.',
        topics: ['migration'],
        threads: [],
        decisions: [],
        actionItems: [],
        unresolved: [],
        glossary: {},
      },
    });

    expect(result.summaryText).toBe('This channel is focused on backend development.');
    expect(result.glossary).toEqual({ ORM: 'Object-Relational Mapping' });
  });

  it('preserves previous summary when analyst fails', async () => {
    const { summarizeChannelProfile } = await import('@/core/summary/summarizeChannelWindow');

    mockChatFn.mockRejectedValueOnce(new Error('LLM Error'));

    const previousSummary = {
      windowStart: new Date('2026-01-14T00:00:00.000Z'),
      windowEnd: new Date('2026-01-15T00:00:00.000Z'),
      summaryText: 'Existing channel history.',
      topics: ['history'],
      threads: [],
      decisions: [],
      actionItems: [],
      unresolved: [],
      glossary: {},
    };

    const result = await summarizeChannelProfile({
      previousSummary,
      latestRollingSummary: {
        windowStart: new Date('2026-01-15T11:00:00.000Z'),
        windowEnd: new Date('2026-01-15T13:00:00.000Z'),
        summaryText: 'New discussion.',
        topics: [],
        threads: [],
        decisions: [],
        actionItems: [],
        unresolved: [],
        glossary: {},
      },
    });

    expect(result.summaryText).toBe('Existing channel history.');
  });
});
