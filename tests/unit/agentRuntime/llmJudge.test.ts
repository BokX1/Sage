import { describe, expect, it } from 'vitest';
import { JudgeModelInvoker, runLlmJudge } from '../../../src/core/agentRuntime/llmJudge';

function buildPayload(params: {
  factual: number;
  instruction: number;
  safety: number;
  completeness: number;
  toolUse: number;
  source: number;
  temporal: number;
  confidence: number;
  issues?: string[];
  summary?: string;
}): string {
  return JSON.stringify({
    scores: {
      factual_grounding: params.factual,
      instruction_adherence: params.instruction,
      safety: params.safety,
      completeness: params.completeness,
      tool_use_correctness: params.toolUse,
      source_quality: params.source,
      temporal_correctness: params.temporal,
    },
    confidence: params.confidence,
    issues: params.issues ?? [],
    summary: params.summary ?? 'ok',
  });
}

describe('llmJudge', () => {
  it('uses the stronger judge result when there is no disagreement', async () => {
    const invoker: JudgeModelInvoker = async ({ role }) => {
      if (role === 'primary') {
        return buildPayload({
          factual: 0.86,
          instruction: 0.84,
          safety: 0.92,
          completeness: 0.8,
          toolUse: 0.75,
          source: 0.79,
          temporal: 0.76,
          confidence: 0.87,
          summary: 'primary',
        });
      }
      return buildPayload({
        factual: 0.81,
        instruction: 0.8,
        safety: 0.9,
        completeness: 0.78,
        toolUse: 0.72,
        source: 0.75,
        temporal: 0.74,
        confidence: 0.83,
        summary: 'secondary',
      });
    };

    const result = await runLlmJudge(
      {
        guildId: null,
        routeKind: 'chat',
        userText: 'summarize this',
        replyText: 'Here is a summary.',
        primaryModel: 'judge-primary',
        secondaryModel: 'judge-secondary',
        adjudicatorModel: 'judge-adjudicator',
      },
      { invoker },
    );

    expect(result.disagreement).toBe(false);
    expect(result.arbitrationUsed).toBe(false);
    expect(result.adjudicator).toBeNull();
    expect(result.final.model).toBe('judge-primary');
    expect(result.final.summary).toBe('primary');
  });

  it('runs adjudicator when primary and secondary disagree', async () => {
    const invoker: JudgeModelInvoker = async ({ role }) => {
      if (role === 'primary') {
        return buildPayload({
          factual: 0.85,
          instruction: 0.82,
          safety: 0.91,
          completeness: 0.8,
          toolUse: 0.74,
          source: 0.78,
          temporal: 0.75,
          confidence: 0.8,
          summary: 'primary pass',
        });
      }
      if (role === 'secondary') {
        return buildPayload({
          factual: 0.3,
          instruction: 0.35,
          safety: 0.4,
          completeness: 0.45,
          toolUse: 0.4,
          source: 0.35,
          temporal: 0.3,
          confidence: 0.8,
          issues: ['weak grounding'],
          summary: 'secondary revise',
        });
      }
      return buildPayload({
        factual: 0.7,
        instruction: 0.72,
        safety: 0.78,
        completeness: 0.68,
        toolUse: 0.64,
        source: 0.7,
        temporal: 0.66,
        confidence: 0.76,
        issues: ['needs citation'],
        summary: 'adjudicated revise',
      });
    };

    const result = await runLlmJudge(
      {
        guildId: null,
        routeKind: 'search',
        userText: 'latest model pricing',
        replyText: 'Pricing changed.',
        primaryModel: 'judge-primary',
        secondaryModel: 'judge-secondary',
        adjudicatorModel: 'judge-adjudicator',
      },
      { invoker },
    );

    expect(result.disagreement).toBe(true);
    expect(result.arbitrationUsed).toBe(true);
    expect(result.adjudicator?.model).toBe('judge-adjudicator');
    expect(result.final.summary).toBe('adjudicated revise');
    expect(result.final.verdict).toBe('revise');
  });

  it('falls back conservatively when adjudicator output is unparseable', async () => {
    const invoker: JudgeModelInvoker = async ({ role }) => {
      if (role === 'primary') {
        return buildPayload({
          factual: 0.88,
          instruction: 0.86,
          safety: 0.9,
          completeness: 0.83,
          toolUse: 0.77,
          source: 0.8,
          temporal: 0.78,
          confidence: 0.84,
          summary: 'primary pass',
        });
      }
      if (role === 'secondary') {
        return buildPayload({
          factual: 0.5,
          instruction: 0.55,
          safety: 0.58,
          completeness: 0.5,
          toolUse: 0.52,
          source: 0.5,
          temporal: 0.49,
          confidence: 0.8,
          summary: 'secondary revise',
        });
      }
      return 'not valid json';
    };

    const result = await runLlmJudge(
      {
        guildId: null,
        routeKind: 'coding',
        userText: 'fix bug',
        replyText: 'Try this patch.',
        primaryModel: 'judge-primary',
        secondaryModel: 'judge-secondary',
        adjudicatorModel: 'judge-adjudicator',
      },
      { invoker },
    );

    expect(result.disagreement).toBe(true);
    expect(result.arbitrationUsed).toBe(true);
    expect(result.adjudicator?.issues).toContain('judge_parse_failed');
    expect(result.final.model).toBe('judge-secondary');
    expect(result.final.verdict).toBe('revise');
  });
});
