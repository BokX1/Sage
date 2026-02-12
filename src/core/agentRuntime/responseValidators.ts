import { AgentKind } from '../orchestration/agentSelector';
import {
  containsLikelyToolEnvelopeFragment,
  isIntentionalToolEnvelopeExampleRequest,
} from './toolVerification';
import {
  RouteValidationPolicy,
  ValidationStrictness,
} from './validationPolicy';

export type ResponseValidationIssueCode =
  | 'empty_reply'
  | 'tool_envelope_leak'
  | 'missing_source_urls'
  | 'missing_checked_on_date'
  | 'invalid_checked_on_date'
  | 'unsupported_certainty_phrase';

export interface ResponseValidationIssue {
  code: ResponseValidationIssueCode;
  message: string;
}

export interface ResponseValidationResult {
  strictness: ValidationStrictness;
  passed: boolean;
  issues: ResponseValidationIssue[];
  blockingIssues: ResponseValidationIssue[];
  warningIssues: ResponseValidationIssue[];
}

const SEARCH_TIME_SENSITIVE_USER_PATTERN =
  /(latest|today|current|now|right now|as of|recent|fresh|newest|release|version|price|weather|news|score)/i;
const SEARCH_SOURCE_REQUEST_PATTERN =
  /(source|sources|citation|cite|reference|references|link|url)/i;
const SEARCH_SOURCE_URL_PATTERN = /https?:\/\/[^\s<>()]+/i;
const SEARCH_SOURCE_LABEL_PATTERN = /source urls?:/i;
const SEARCH_CHECKED_ON_PATTERN = /checked on:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i;
const UNSUPPORTED_CERTAINTY_PATTERN =
  /(trust me|definitely|always|never|guaranteed|100%|no need to verify|certainly)/i;

function isIsoDate(dateText: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return false;
  const parsed = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === dateText;
}

function collectIssues(params: {
  routeKind: AgentKind;
  userText: string;
  replyText: string;
  policy: RouteValidationPolicy;
}): ResponseValidationIssue[] {
  const issues: ResponseValidationIssue[] = [];
  const trimmedReply = params.replyText.trim();
  const allowIntentionalToolEnvelopeExample = isIntentionalToolEnvelopeExampleRequest(params.userText);

  if (params.policy.checkEmptyReply && trimmedReply.length === 0) {
    issues.push({
      code: 'empty_reply',
      message: 'Reply is empty after trimming.',
    });
  }

  if (
    params.policy.checkToolEnvelopeLeak &&
    trimmedReply.length > 0 &&
    containsLikelyToolEnvelopeFragment(trimmedReply) &&
    !allowIntentionalToolEnvelopeExample
  ) {
    issues.push({
      code: 'tool_envelope_leak',
      message: 'Reply still contains a tool-call envelope.',
    });
  }

  if (
    params.policy.checkUnsupportedCertainty &&
    UNSUPPORTED_CERTAINTY_PATTERN.test(trimmedReply)
  ) {
    issues.push({
      code: 'unsupported_certainty_phrase',
      message:
        'Reply uses unsupported certainty phrasing for verifiable/freshness-sensitive behavior.',
    });
  }

  if (params.routeKind !== 'search') {
    return issues;
  }

  const asksFreshnessOrSources =
    SEARCH_TIME_SENSITIVE_USER_PATTERN.test(params.userText) ||
    SEARCH_SOURCE_REQUEST_PATTERN.test(params.userText);
  const checkedOnMatch = trimmedReply.match(SEARCH_CHECKED_ON_PATTERN);

  if (params.policy.checkSearchSourceUrls) {
    if (
      asksFreshnessOrSources &&
      (!SEARCH_SOURCE_LABEL_PATTERN.test(trimmedReply) ||
        !SEARCH_SOURCE_URL_PATTERN.test(trimmedReply))
    ) {
      issues.push({
        code: 'missing_source_urls',
        message:
          'Search reply is missing source URLs for a freshness/source-sensitive request.',
      });
    }
  }

  if (params.policy.checkSearchCheckedOnDate) {
    if (asksFreshnessOrSources && !checkedOnMatch) {
      issues.push({
        code: 'missing_checked_on_date',
        message:
          'Search reply is missing a "Checked on: YYYY-MM-DD" marker for freshness/source-sensitive request.',
      });
    } else if (checkedOnMatch && !isIsoDate(checkedOnMatch[1])) {
      issues.push({
        code: 'invalid_checked_on_date',
        message: 'Search reply contains an invalid "Checked on" date format/value.',
      });
    }
  }

  return issues;
}

export function validateResponseForRoute(params: {
  routeKind: AgentKind;
  userText: string;
  replyText: string;
  policy: RouteValidationPolicy;
}): ResponseValidationResult {
  const strictness = params.policy.strictness;
  if (strictness === 'off') {
    return {
      strictness,
      passed: true,
      issues: [],
      blockingIssues: [],
      warningIssues: [],
    };
  }

  const issues = collectIssues(params);
  const blockingIssues = strictness === 'enforce' ? issues : [];
  const warningIssues = strictness === 'warn' ? issues : [];

  return {
    strictness,
    passed: blockingIssues.length === 0,
    issues,
    blockingIssues,
    warningIssues,
  };
}

export function buildValidationRepairInstruction(params: {
  routeKind: AgentKind;
  userText: string;
  issueCodes: ResponseValidationIssueCode[];
  currentDateIso: string;
}): string {
  const lines: string[] = [
    'Validation repair required.',
    `Route: ${params.routeKind}`,
    `User request: ${params.userText}`,
    `Validation issue codes: ${params.issueCodes.join(', ') || 'none'}`,
    `Current date: ${params.currentDateIso}`,
    'Return plain text only (no JSON envelope).',
  ];

  if (params.routeKind === 'search') {
    lines.push(
      'For search responses, include "Source URLs: <url ...>" for factual claims and include "Checked on: YYYY-MM-DD" when freshness/source sensitivity is present.',
    );
  }

  lines.push(
    'Avoid certainty overclaims. If evidence is unavailable, explicitly acknowledge limitation instead of asserting certainty.',
  );
  return lines.join('\n');
}
