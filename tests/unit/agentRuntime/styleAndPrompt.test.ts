import { describe, it, expect } from 'vitest';
import { classifyStyle } from '../../../src/core/agentRuntime/styleClassifier';
import { composeSystemPrompt } from '../../../src/core/agentRuntime/promptComposer';
import {
  budgetSystemPrompt,
  PromptBlock,
  renderPromptBlocks,
} from '../../../src/core/agentRuntime/promptBlocks';

describe('Style Classifier (D8)', () => {
  it('detects high humor', () => {
    expect(classifyStyle('tell me a funny joke').humor).toBe('high');
    expect(classifyStyle('lol that is hilarious').humor).toBe('high');
  });

  it('disables humor for serious requests', () => {
    expect(classifyStyle('be serious code only').humor).toBe('none');
    expect(classifyStyle('no jokes please').humor).toBe('none');
  });

  it('detects verbosity', () => {
    expect(classifyStyle('tl;dr summarize this').verbosity).toBe('low');
    expect(classifyStyle('explain in detail step-by-step').verbosity).toBe('high');
  });

  it('detects formality', () => {
    expect(classifyStyle('yo wassup').formality).toBe('low');
    expect(classifyStyle('could you kindly assist me sir').formality).toBe('high');
  });
});

describe('Prompt Blocks & Budgeting', () => {
  it('sorts blocks deterministically', () => {
    const blocks: PromptBlock[] = [
      { id: 'b', title: 'B', content: 'b', priority: 10 },
      { id: 'a', title: 'A', content: 'a', priority: 10 },
      { id: 'c', title: 'C', content: 'c', priority: 20 },
    ];
    const rendered = renderPromptBlocks(blocks);
    // Expect C (p20), then A (p10, title A), then B (p10, title B)
    // Note: render checks title first.
    // ## C ... ## A ... ## B
    expect(rendered.indexOf('## C')).toBeLessThan(rendered.indexOf('## A'));
    expect(rendered.indexOf('## A')).toBeLessThan(rendered.indexOf('## B'));
  });

  it('drops low priority non-essential blocks first', () => {
    const blocks: PromptBlock[] = [
      { id: 'core', title: 'Core', content: 'core', priority: 100, essential: true },
      { id: 'humor', title: 'Humor', content: 'humor block', priority: 50 },
      { id: 'style', title: 'Style', content: 'style block', priority: 60 },
    ];

    // Estimator is approx chars/4.
    // "humor block" (11) -> 3 tok + 4 = 7
    // "style block" (11) -> 3 tok + 4 = 7
    // "core" (4) -> 1 tok + 4 = 5
    // T = 19. Limit 15.
    // Should drop humor (50 < 60).

    const budgeted = budgetSystemPrompt(blocks, 15);
    const ids = budgeted.map((b) => b.id);

    expect(ids).toContain('core');
    expect(ids).toContain('style');
    expect(ids).not.toContain('humor');
  });

  it('never drops essential blocks even if over budget', () => {
    const blocks: PromptBlock[] = [
      {
        id: 'core',
        title: 'Core',
        content: 'very long core content '.repeat(100),
        priority: 100,
        essential: true,
      },
    ];
    // Budget 0
    const budgeted = budgetSystemPrompt(blocks, 0);
    expect(budgeted.length).toBe(1);
    expect(budgeted[0].id).toBe('core');
  });
});

describe('Prompt Composer Integration', () => {
  it('composes system prompt with style hint', () => {
    const prompt = composeSystemPrompt({
      style: {
        verbosity: 'low',
        formality: 'high',
        humor: 'none',
        directness: 'high',
      },
    });

    expect(prompt).toContain('Verbosity: low');
    expect(prompt).toContain('Humor: none');
    expect(prompt).toContain('You are Sage'); // Identity block
  });

  it('includes humor policy by default', () => {
    const prompt = composeSystemPrompt();
    expect(prompt).toContain('Humor Policy');
  });
});
