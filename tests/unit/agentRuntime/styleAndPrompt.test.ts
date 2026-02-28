import { describe, it, expect } from 'vitest';
import { classifyStyle } from '../../../src/core/agentRuntime/styleClassifier';
import { composeSystemPrompt } from '../../../src/core/agentRuntime/promptComposer';

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

describe('Prompt Composer Integration', () => {
  it('composes system prompt with style hint', () => {
    const prompt = composeSystemPrompt({
      userProfileSummary: null,
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
    expect(prompt).toContain('<user_context>'); // Memory block
  });

  it('includes default sections', () => {
    const prompt = composeSystemPrompt({
      userProfileSummary: 'User loves cats',
    });
    expect(prompt).toContain('User loves cats');
    expect(prompt).toContain('Priority Instruction');
  });
});
