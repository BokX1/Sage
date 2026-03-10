import { describe, it, expect } from 'vitest';
import {
  budgetContextBlocks,
  type ContextBlock,
  DEFAULT_TRUNCATION_NOTICE,
} from '@/features/agent-runtime/contextBudgeter';

const estimateTokens = (text: string) => Math.ceil(text.length / 4);
const overheadTokens = 4;

function buildBlocks(overrides: Partial<ContextBlock>[] = []): ContextBlock[] {
  const baseBlocks: ContextBlock[] = [
    {
      id: 'base_system',
      role: 'system',
      content: 'Base system prompt.',
      priority: 100,
      truncatable: false,
    },
    {
      id: 'server_instructions',
      role: 'system',
      content: 'Memory block content.',
      priority: 90,
      truncatable: true,
    },
    {
      id: 'runtime_instruction',
      role: 'system',
      content: 'Runtime instruction content.',
      priority: 70,
      truncatable: true,
    },
    {
      id: 'voice_context',
      role: 'system',
      content: 'Voice context content.',
      priority: 60,
      truncatable: true,
    },
    {
      id: 'transcript',
      role: 'system',
      content: 'Transcript content.',
      priority: 50,
      truncatable: true,
    },
    {
      id: 'reply_context',
      role: 'assistant',
      content: 'Reply context content.',
      priority: 40,
      truncatable: true,
    },
    {
      id: 'user',
      role: 'user',
      content: 'User message content.',
      priority: 110,
      truncatable: true,
    },
  ];

  return baseBlocks.map((block, index) => ({ ...block, ...overrides[index] }));
}

function contentText(content: ContextBlock['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

function totalTokens(blocks: ContextBlock[]): number {
  return blocks.reduce(
    (sum, block) => sum + estimateTokens(contentText(block.content)) + overheadTokens,
    0,
  );
}

describe('budgetContextBlocks', () => {
  it('keeps ordering stable', () => {
    const blocks = buildBlocks();

    const result = budgetContextBlocks(blocks, {
      maxInputTokens: 10_000,
      reservedOutputTokens: 0,
      estimateTokens,
    });

    expect(result.map((block) => block.id)).toEqual(blocks.map((block) => block.id));
  });

  it('drops transcript before summaries', () => {
    const transcript = 'T'.repeat(2000);
    const voiceContext = 'Voice context content.';
    const blocks = buildBlocks([{}, {}, {}, { content: voiceContext }, { content: transcript }]);

    const result = budgetContextBlocks(blocks, {
      maxInputTokens: 200,
      reservedOutputTokens: 0,
      estimateTokens,
    });

    const transcriptBlock = result.find((block) => block.id === 'transcript');
    const voiceBlock = result.find((block) => block.id === 'voice_context');

    expect(voiceBlock).toBeDefined();
    expect(transcriptBlock).toBeUndefined();
  });

  it('ensures total tokens fit within budget', () => {
    const blocks = buildBlocks([{}, {}, {}, {}, { content: 'T'.repeat(1000) }]);

    const result = budgetContextBlocks(blocks, {
      maxInputTokens: 150,
      reservedOutputTokens: 25,
      estimateTokens,
    });

    const maxAllowed = 150 - 25;
    expect(totalTokens(result)).toBeLessThanOrEqual(maxAllowed);
  });

  it('keeps user message even under heavy truncation', () => {
    const blocks = buildBlocks([
      { content: 'Base system prompt.'.repeat(50) },
      { content: 'Memory block content.'.repeat(50) },
      { content: 'Runtime instruction content.'.repeat(50) },
      { content: 'Voice context content.'.repeat(50) },
      { content: 'Transcript content.'.repeat(200) },
      { content: 'Reply context content.'.repeat(50) },
      { content: 'User message content.'.repeat(50) },
    ]);

    const result = budgetContextBlocks(blocks, {
      maxInputTokens: 120,
      reservedOutputTokens: 0,
      estimateTokens,
    });

    expect(result.map((block) => block.id)).toContain('user');
  });

  it('adds truncation notice when truncation occurs', () => {
    const blocks = buildBlocks([{}, {}, {}, {}, { content: 'Transcript content.'.repeat(200) }]);

    const result = budgetContextBlocks(blocks, {
      maxInputTokens: 120,
      reservedOutputTokens: 0,
      estimateTokens,
      truncationNoticeEnabled: true,
      truncationNoticeText: DEFAULT_TRUNCATION_NOTICE,
    });

    const noticeIndex = result.findIndex((block) => block.id === 'trunc_notice');
    const baseIndex = result.findIndex((block) => block.id === 'base_system');

    expect(noticeIndex).toBe(baseIndex + 1);
    expect(result[noticeIndex].content).toBe(DEFAULT_TRUNCATION_NOTICE);
  });

  it('keeps the most recent user_input portion when a combined user block is truncated', () => {
    const replyReference = 'Reply reference for context only:\n<reply_reference>\n' + 'Old context '.repeat(300) + '\n</reply_reference>\n\n';
    const userInput = '<user_input>\nCurrent user ask must survive.\n</user_input>';
    const blocks = buildBlocks([
      { content: 'Base system prompt.' },
      { content: 'Memory block content.' },
      { content: 'Runtime instruction content.' },
      { content: 'Voice context content.' },
      { content: 'Transcript content.' },
      { content: 'Reply context content.' },
      { content: `${replyReference}${userInput}` },
    ]);

    const result = budgetContextBlocks(blocks, {
      maxInputTokens: 120,
      reservedOutputTokens: 0,
      estimateTokens,
    });

    const userBlock = result.find((block) => block.id === 'user');
    expect(userBlock).toBeDefined();
    const text = contentText(userBlock!.content);
    expect(text).toContain('<user_input>');
    expect(text).toContain('Current user ask must survive.');
  });
});
