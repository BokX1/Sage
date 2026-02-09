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
OR respond with a plain text answer if you don't need to use tools.`;

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
 * Parse a model response into a validated tool-call envelope.
 *
 * @param text - Raw model output, optionally fenced in markdown code blocks.
 * @returns Parsed envelope when valid, otherwise null.
 *
 * Error behavior:
 * - JSON parse and shape errors are swallowed and mapped to null.
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
    return null;
  }
}
