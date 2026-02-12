import { parseToolCallEnvelope } from './toolCallParser';

const TOOL_ENVELOPE_TYPE_PATTERN = /"type"\s*:\s*"tool_calls"/i;
const TOOL_ENVELOPE_CALLS_PATTERN = /"calls"\s*:/i;
const TOOL_ENVELOPE_NAME_PATTERN = /"name"\s*:/i;
const TOOL_ENVELOPE_CODE_FENCE_PATTERN = /```(?:json)?\s*\n?([\s\S]*?)\n?```/i;
const TOOL_ENVELOPE_INLINE_OBJECT_PATTERN =
  /\{[\s\S]*?"type"\s*:\s*"tool_calls"[\s\S]*?"calls"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/i;
const TOOL_ENVELOPE_INTENT_ACTION_PATTERN =
  /(show|provide|give|send|return|output|print|share|example|sample|template|schema|format|syntax|raw|exact|literal|verbatim)/i;
const TOOL_ENVELOPE_INTENT_TOPIC_PATTERN =
  /(tool[_\s-]?calls?|tool call envelope|internal payload|protocol payload|json payload|raw json|"type"\s*:\s*"tool_calls")/i;
const TOOL_ENVELOPE_INTENT_QUESTION_PATTERN =
  /(what does|how does|looks?\s+like|look\s+like|explain|meaning|why)/i;

function stripCodeFences(text: string): string {
  const fencePattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i;
  const match = text.trim().match(fencePattern);
  return match ? match[1].trim() : text.trim();
}

function hasToolEnvelopeMarkers(text: string): boolean {
  return (
    TOOL_ENVELOPE_TYPE_PATTERN.test(text) &&
    TOOL_ENVELOPE_CALLS_PATTERN.test(text) &&
    TOOL_ENVELOPE_NAME_PATTERN.test(text)
  );
}

function hasLooseToolEnvelopeHint(text: string): boolean {
  if (!hasToolEnvelopeMarkers(text)) return false;

  const typeMatchIndex = text.search(TOOL_ENVELOPE_TYPE_PATTERN);
  const callsMatchIndex = text.search(TOOL_ENVELOPE_CALLS_PATTERN);
  if (typeMatchIndex < 0 || callsMatchIndex < 0) return false;

  const hasObjectStartBeforeType = text.lastIndexOf('{', typeMatchIndex) >= 0;
  const hasCallArrayAfterCalls = text.indexOf('[', callsMatchIndex) >= 0;

  return hasObjectStartBeforeType && hasCallArrayAfterCalls;
}

export function isLikelyToolEnvelopeDraft(text: string | null | undefined): boolean {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return false;
  if (parseToolCallEnvelope(trimmed)) return true;

  const stripped = stripCodeFences(trimmed);
  if (!stripped.startsWith('{') && !stripped.startsWith('[')) return false;

  return hasToolEnvelopeMarkers(stripped);
}

export function containsLikelyToolEnvelopeFragment(text: string | null | undefined): boolean {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return false;
  if (isLikelyToolEnvelopeDraft(trimmed)) return true;

  const stripped = stripCodeFences(trimmed);
  if (isLikelyToolEnvelopeDraft(stripped)) return true;

  const fenceMatches = trimmed.matchAll(new RegExp(TOOL_ENVELOPE_CODE_FENCE_PATTERN.source, 'gi'));
  for (const match of fenceMatches) {
    const block = typeof match[1] === 'string' ? match[1].trim() : '';
    if (!block) continue;
    if (isLikelyToolEnvelopeDraft(block) || hasLooseToolEnvelopeHint(block)) {
      return true;
    }
  }

  if (TOOL_ENVELOPE_INLINE_OBJECT_PATTERN.test(trimmed)) {
    return true;
  }

  return hasLooseToolEnvelopeHint(trimmed);
}

export function isIntentionalToolEnvelopeExampleRequest(userText: string | null | undefined): boolean {
  const trimmed = typeof userText === 'string' ? userText.trim() : '';
  if (!trimmed) return false;
  if (!TOOL_ENVELOPE_INTENT_TOPIC_PATTERN.test(trimmed)) return false;
  return (
    TOOL_ENVELOPE_INTENT_ACTION_PATTERN.test(trimmed) ||
    TOOL_ENVELOPE_INTENT_QUESTION_PATTERN.test(trimmed)
  );
}

export function removeLikelyToolEnvelopeFragments(text: string): string {
  if (!text.trim()) return text.trim();

  let sanitized = text;

  sanitized = sanitized.replace(new RegExp(TOOL_ENVELOPE_CODE_FENCE_PATTERN.source, 'gi'), (fullMatch, block) => {
    const candidate = typeof block === 'string' ? block : fullMatch;
    return hasToolEnvelopeMarkers(candidate) ? '' : fullMatch;
  });

  sanitized = sanitized.replace(
    new RegExp(TOOL_ENVELOPE_INLINE_OBJECT_PATTERN.source, 'gi'),
    (candidate) => {
      return hasToolEnvelopeMarkers(candidate) ? '' : candidate;
    },
  );

  return sanitized.replace(/\n{3,}/g, '\n\n').trim();
}

export function stripToolEnvelopeDraft(text: string | null | undefined): string | null {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return null;
  return isLikelyToolEnvelopeDraft(trimmed) ? null : trimmed;
}
