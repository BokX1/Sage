import { describe, expect, it } from 'vitest';
import {
  containsLikelyToolEnvelopeFragment,
  isIntentionalToolEnvelopeExampleRequest,
  isLikelyToolEnvelopeDraft,
  removeLikelyToolEnvelopeFragments,
  stripToolEnvelopeDraft,
} from '../../../src/core/agentRuntime/toolVerification';

describe('toolVerification helpers', () => {
  it('removes tool envelope drafts and keeps plain text answers', () => {
    const envelope = JSON.stringify({
      type: 'tool_calls',
      calls: [{ name: 'search_web', args: { scope: 'latest' } }],
    });

    expect(stripToolEnvelopeDraft(envelope)).toBeNull();
    expect(stripToolEnvelopeDraft(`\`\`\`json\n${envelope}\n\`\`\``)).toBeNull();
    expect(stripToolEnvelopeDraft('  Final verified answer.  ')).toBe('Final verified answer.');
    expect(stripToolEnvelopeDraft('   ')).toBeNull();
  });

  it('treats malformed tool-envelope JSON as a draft leak', () => {
    const malformed = '{"type":"tool_calls","calls":[{"name":"web_search","args":{"q":"latest"}},]';
    expect(isLikelyToolEnvelopeDraft(malformed)).toBe(true);
    expect(stripToolEnvelopeDraft(malformed)).toBeNull();
  });

  it('detects embedded tool-envelope fragments', () => {
    const embedded =
      'Here is what happened:\n```json\n{"type":"tool_calls","calls":[{"name":"web_search","args":{"q":"hello"}}]}\n```';
    expect(isLikelyToolEnvelopeDraft(embedded)).toBe(false);
    expect(containsLikelyToolEnvelopeFragment(embedded)).toBe(true);
  });

  it('does not treat unrelated JSON as a tool envelope', () => {
    const unrelated = '{"type":"summary","items":[{"name":"alpha"}]}';
    expect(isLikelyToolEnvelopeDraft(unrelated)).toBe(false);
    expect(stripToolEnvelopeDraft(unrelated)).toBe(unrelated);
  });

  it('detects explicit user requests for tool-call examples', () => {
    expect(isIntentionalToolEnvelopeExampleRequest('show exact tool_calls json example')).toBe(true);
    expect(isIntentionalToolEnvelopeExampleRequest('what does tool_calls json look like?')).toBe(true);
    expect(isIntentionalToolEnvelopeExampleRequest('check out the tools please')).toBe(false);
  });

  it('removes embedded envelope fragments while keeping surrounding text', () => {
    const withLeak =
      'Summary first.\n```json\n{"type":"tool_calls","calls":[{"name":"web_search","args":{"q":"hello"}}]}\n```\nFinal line.';
    expect(removeLikelyToolEnvelopeFragments(withLeak)).toBe('Summary first.\n\nFinal line.');
  });

  it('does not flag plain explanatory prose as an embedded tool envelope fragment', () => {
    const prose =
      'The fields "type":"tool_calls", "calls", and "name" are required in the schema description.';
    expect(containsLikelyToolEnvelopeFragment(prose)).toBe(false);
  });

  it('detects inline envelope fragments consistently across repeated calls', () => {
    const inlineLeak =
      'Short answer {"type":"tool_calls","calls":[{"name":"web_search","args":{"q":"hello"}}]} tail.';
    expect(containsLikelyToolEnvelopeFragment(inlineLeak)).toBe(true);
    expect(containsLikelyToolEnvelopeFragment(inlineLeak)).toBe(true);
  });
});
