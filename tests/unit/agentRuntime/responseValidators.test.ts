import { describe, expect, it } from 'vitest';
import {
  buildValidationRepairInstruction,
  validateResponseForRoute,
} from '../../../src/core/agentRuntime/responseValidators';
import { resolveRouteValidationPolicy } from '../../../src/core/agentRuntime/validationPolicy';

describe('responseValidators', () => {
  it('blocks search replies missing source URLs and checked date under enforce policy', () => {
    const policy = resolveRouteValidationPolicy({
      routeKind: 'search',
      validatorsEnabled: true,
    });
    const result = validateResponseForRoute({
      routeKind: 'search',
      userText: 'What is the latest Python version today?',
      replyText: 'Python is currently version 3.13.',
      policy,
    });

    expect(result.passed).toBe(false);
    expect(result.blockingIssues.map((issue) => issue.code)).toEqual([
      'missing_source_urls',
      'missing_checked_on_date',
    ]);
  });

  it('flags invalid checked-on date values for search route', () => {
    const policy = resolveRouteValidationPolicy({
      routeKind: 'search',
      validatorsEnabled: true,
    });
    const result = validateResponseForRoute({
      routeKind: 'search',
      userText: 'latest release notes for node',
      replyText:
        'Node latest release details.\nSource URLs: https://nodejs.org/en/blog/release\nChecked on: 2026-13-40',
      policy,
    });

    expect(result.passed).toBe(false);
    expect(result.blockingIssues.map((issue) => issue.code)).toContain(
      'invalid_checked_on_date',
    );
  });

  it('treats certainty phrasing as warning for default chat policy', () => {
    const policy = resolveRouteValidationPolicy({
      routeKind: 'chat',
      validatorsEnabled: true,
    });
    const result = validateResponseForRoute({
      routeKind: 'chat',
      userText: 'is this always true?',
      replyText: 'This is definitely always true.',
      policy,
    });

    expect(result.passed).toBe(true);
    expect(result.warningIssues.map((issue) => issue.code)).toEqual([
      'unsupported_certainty_phrase',
    ]);
  });

  it('can enforce coding route via policy override JSON', () => {
    const policy = resolveRouteValidationPolicy({
      routeKind: 'coding',
      validatorsEnabled: true,
      policyJson: JSON.stringify({
        coding: {
          strictness: 'enforce',
        },
      }),
    });
    const result = validateResponseForRoute({
      routeKind: 'coding',
      userText: 'is this command definitely safe?',
      replyText: 'This command is definitely always safe.',
      policy,
    });

    expect(result.passed).toBe(false);
    expect(result.blockingIssues.map((issue) => issue.code)).toEqual([
      'unsupported_certainty_phrase',
    ]);
  });

  it('detects tool-call envelope leakage', () => {
    const policy = resolveRouteValidationPolicy({
      routeKind: 'chat',
      validatorsEnabled: true,
      policyJson: JSON.stringify({
        chat: {
          strictness: 'enforce',
        },
      }),
    });
    const result = validateResponseForRoute({
      routeKind: 'chat',
      userText: 'hello',
      replyText: JSON.stringify({
        type: 'tool_calls',
        calls: [{ name: 'web_search', args: { query: 'hello' } }],
      }),
      policy,
    });

    expect(result.passed).toBe(false);
    expect(result.blockingIssues.map((issue) => issue.code)).toEqual([
      'tool_envelope_leak',
    ]);
  });

  it('detects malformed tool-call envelope leakage', () => {
    const policy = resolveRouteValidationPolicy({
      routeKind: 'chat',
      validatorsEnabled: true,
      policyJson: JSON.stringify({
        chat: {
          strictness: 'enforce',
        },
      }),
    });
    const result = validateResponseForRoute({
      routeKind: 'chat',
      userText: 'hello',
      replyText: '{"type":"tool_calls","calls":[{"name":"web_search","args":{"q":"hello"}},]',
      policy,
    });

    expect(result.passed).toBe(false);
    expect(result.blockingIssues.map((issue) => issue.code)).toEqual([
      'tool_envelope_leak',
    ]);
  });

  it('detects embedded tool-call envelope leakage in prose', () => {
    const policy = resolveRouteValidationPolicy({
      routeKind: 'chat',
      validatorsEnabled: true,
      policyJson: JSON.stringify({
        chat: {
          strictness: 'enforce',
        },
      }),
    });
    const result = validateResponseForRoute({
      routeKind: 'chat',
      userText: 'hello',
      replyText:
        'Here is the internal payload:\n```json\n{"type":"tool_calls","calls":[{"name":"web_search","args":{"q":"hello"}}]}\n```',
      policy,
    });

    expect(result.passed).toBe(false);
    expect(result.blockingIssues.map((issue) => issue.code)).toEqual([
      'tool_envelope_leak',
    ]);
  });

  it('allows tool-call examples when the user explicitly requests them', () => {
    const policy = resolveRouteValidationPolicy({
      routeKind: 'chat',
      validatorsEnabled: true,
      policyJson: JSON.stringify({
        chat: {
          strictness: 'enforce',
        },
      }),
    });
    const result = validateResponseForRoute({
      routeKind: 'chat',
      userText: 'show exact tool_calls json example',
      replyText: '{"type":"tool_calls","calls":[{"name":"web_search","args":{"q":"hello"}}]}',
      policy,
    });

    expect(result.passed).toBe(true);
    expect(result.blockingIssues).toHaveLength(0);
  });

  it('builds deterministic repair instruction text with issue codes', () => {
    const instruction = buildValidationRepairInstruction({
      routeKind: 'search',
      userText: 'latest model pricing',
      issueCodes: ['missing_source_urls', 'missing_checked_on_date'],
      currentDateIso: '2026-02-11',
    });

    expect(instruction).toContain('Validation issue codes: missing_source_urls, missing_checked_on_date');
    expect(instruction).toContain('Current date: 2026-02-11');
    expect(instruction).toContain('Source URLs: <url ...>');
  });
});
