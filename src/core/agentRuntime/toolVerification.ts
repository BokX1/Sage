import { parseToolCallEnvelope } from './toolCallParser';

export function stripToolEnvelopeDraft(text: string | null | undefined): string | null {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return null;
  return parseToolCallEnvelope(trimmed) ? null : trimmed;
}
