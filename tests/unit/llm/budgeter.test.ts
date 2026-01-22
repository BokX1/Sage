import { describe, expect, it } from 'vitest';
import {
  estimateMessageTokens,
  planBudget,
  trimMessagesToBudget,
} from '../../../src/core/llm/budget/budgeter';

const estimator = {
  charsPerToken: 1,
  codeCharsPerToken: 1,
  imageTokens: 10,
  messageOverheadTokens: 0,
};

const limits = {
  model: 'test-model',
  maxContextTokens: 80,
  maxOutputTokens: 10,
  safetyMarginTokens: 0,
  visionEnabled: true,
};

describe('budgeter', () => {
  it('preserves system messages when trimming', () => {
    const messages = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'u'.repeat(40) },
      { role: 'assistant', content: 'a'.repeat(40) },
      { role: 'user', content: 'u2'.repeat(40) },
    ];

    const plan = planBudget(limits, { reservedOutputTokens: 10 });
    const result = trimMessagesToBudget(messages, plan, {
      keepLastUserTurns: 1,
      estimator,
    });

    expect(result.trimmed[0]?.role).toBe('system');
    expect(result.trimmed.some((msg) => msg.role === 'system')).toBe(true);
  });

  it('keeps the last N user turns', () => {
    const messages = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' },
    ];

    const plan = planBudget({ ...limits, maxContextTokens: 8 }, { reservedOutputTokens: 0 });
    const result = trimMessagesToBudget(messages, plan, {
      keepLastUserTurns: 2,
      estimator,
    });

    const contents = result.trimmed.map((msg) => msg.content);
    const userMessages = result.trimmed.filter((msg) => msg.role === 'user');
    expect(userMessages.length).toBeGreaterThanOrEqual(2);
    expect(userMessages[userMessages.length - 1].content).toContain('u3');
    expect(contents).not.toContain('u1');
  });

  it('applies vision fade to older images', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'older image' },
          { type: 'image_url', image_url: { url: 'https://example.com/1.png' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'latest image' },
          { type: 'image_url', image_url: { url: 'https://example.com/2.png' } },
        ],
      },
    ];

    const plan = planBudget({ ...limits, maxContextTokens: 200 }, { reservedOutputTokens: 0 });
    const result = trimMessagesToBudget(messages, plan, {
      visionFadeKeepLastUserImages: 1,
      estimator,
    });
    expect(typeof result.trimmed[0].content).toBe('string');
    expect(result.trimmed[0].content).toContain('Image omitted from history');
  });

  it('truncates attachment blocks to the configured max', () => {
    const attachmentText = 'a'.repeat(50);
    const content = `Here is a file:\n--- BEGIN FILE ATTACHMENT: test.txt ---\n${attachmentText}\n--- END FILE ATTACHMENT ---`;
    const messages = [{ role: 'user', content }];

    const plan = planBudget({ ...limits, maxContextTokens: 500 }, { reservedOutputTokens: 0 });
    const result = trimMessagesToBudget(messages, plan, {
      attachmentTextMaxTokens: 10,
      estimator,
    });

    const updated = String(result.trimmed[0].content);
    expect(updated).toContain('Attachment');
    expect(updated).toContain('truncated');
    const match = updated.match(
      /--- BEGIN FILE ATTACHMENT: test\\.txt ---\\n([\\s\\S]*?)\\n--- END FILE ATTACHMENT ---/,
    );
    expect(match?.[1]?.length ?? 0).toBeLessThanOrEqual(10);
  });

  it('never returns empty messages', () => {
    const plan = planBudget({ ...limits, maxContextTokens: 1 }, { reservedOutputTokens: 0 });
    const result = trimMessagesToBudget([], plan, { estimator });
    expect(result.trimmed.length).toBeGreaterThan(0);
  });

  it('estimator is monotonic with more text', () => {
    const shortMsg = { role: 'user', content: 'hello' };
    const longMsg = { role: 'user', content: 'hello world, this is longer' };

    const shortTokens = estimateMessageTokens(shortMsg, estimator);
    const longTokens = estimateMessageTokens(longMsg, estimator);

    expect(longTokens).toBeGreaterThanOrEqual(shortTokens);
  });
});
