/** Parse and validate structured tool-call envelopes emitted by the model. */
export interface ToolCallEnvelope {
  type: 'tool_calls';
  calls: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
}

/** Provide deterministic retry guidance when model output is invalid JSON. */
export const RETRY_PROMPT = `Your previous response was not valid JSON. Output ONLY valid JSON matching the exact schema:
{
  "type": "tool_calls",
  "calls": [{ "name": "<tool_name>", "args": { ... } }]
}
OR respond with the final user-facing answer in plain text.
Do not mention tools, JSON, or internal protocol details in the plain text answer.`;

function stripCodeFences(text: string): string {
  const fencePattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
  const match = text.trim().match(fencePattern);
  return match ? match[1].trim() : text.trim();
}

/**
 * Detect whether a response is likely intended as JSON tool output.
 *
 * @param text - Raw model output.
 * @returns True when shape markers suggest JSON content.
 */
export function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
    (trimmed.includes('"type"') || trimmed.includes('"name"') || trimmed.includes('"calls"'))
  );
}

/**
 * Attempt to extract a tool-call JSON block from mixed text+JSON content.
 *
 * Models sometimes output reasoning text before/after a JSON envelope.
 * This finds the first `{"type":"tool_calls"...}` block in the text.
 *
 * @param text - Raw model output potentially containing JSON among prose.
 * @returns Extracted JSON string or null if no candidate found.
 */
function extractEnvelopeFromMixedContent(text: string): string | null {
  // Look for JSON block in code fences first
  const fencedPattern = /```(?:json)?\s*\n?(\{[\s\S]*?"type"\s*:\s*"tool_calls"[\s\S]*?\})\s*\n?```/;
  const fencedMatch = text.match(fencedPattern);
  if (fencedMatch) return fencedMatch[1].trim();

  // Bare extraction: find the first `{` that starts a block containing "tool_calls"
  // and use brace-counting to find the matching closing `}`.
  const marker = '"tool_calls"';
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return null;

  // Walk backward to find the opening `{`
  let startIndex = -1;
  for (let i = markerIndex - 1; i >= 0; i--) {
    if (text[i] === '{') {
      startIndex = i;
      break;
    }
  }
  if (startIndex === -1) return null;

  // Walk forward from startIndex counting braces to find matching close
  let depth = 0;
  for (let i = startIndex; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    if (depth === 0) {
      return text.slice(startIndex, i + 1).trim();
    }
  }

  return null;
}

/**
 * Parse a model response into a validated tool-call envelope.
 *
 * @param text - Raw model output, optionally fenced in markdown code blocks.
 * @returns Parsed envelope when valid, otherwise null.
 *
 * Error behavior:
 * - JSON parse and shape errors are swallowed and mapped to null.
 * - Falls back to mixed-content extraction when full-text parse fails.
 */
export function parseToolCallEnvelope(text: string): ToolCallEnvelope | null {
  try {
    const stripped = stripCodeFences(text);
    const parsed = JSON.parse(stripped);

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      parsed.type === 'tool_calls' &&
      Array.isArray(parsed.calls)
    ) {
      const validCalls = parsed.calls.every(
        (c: unknown) =>
          typeof c === 'object' &&
          c !== null &&
          typeof (c as { name?: unknown }).name === 'string' &&
          typeof (c as { args?: unknown }).args === 'object' &&
          (c as { args?: unknown }).args !== null &&
          !Array.isArray((c as { args?: unknown }).args),
      );
      if (validCalls) {
        return parsed as ToolCallEnvelope;
      }
    }
    return null;
  } catch {
    // Full-text parse failed — try extracting envelope from mixed content
    const extracted = extractEnvelopeFromMixedContent(text);
    if (extracted) {
      try {
        const parsed = JSON.parse(extracted);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          parsed.type === 'tool_calls' &&
          Array.isArray(parsed.calls)
        ) {
          const validCalls = parsed.calls.every(
            (c: unknown) =>
              typeof c === 'object' &&
              c !== null &&
              typeof (c as { name?: unknown }).name === 'string' &&
              typeof (c as { args?: unknown }).args === 'object' &&
              (c as { args?: unknown }).args !== null &&
              !Array.isArray((c as { args?: unknown }).args),
          );
          if (validCalls) {
            return parsed as ToolCallEnvelope;
          }
        }
      } catch {
        // Extracted content also failed to parse — give up
      }
    }
    return null;
  }
}
