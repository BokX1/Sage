import { describe, expect, it } from 'vitest';
import {
  buildToolIntentReason,
  buildVerificationToolNames,
  stripToolEnvelopeDraft,
} from '../../../src/core/agentRuntime/toolVerification';

describe('toolVerification helpers', () => {
  it('returns expected virtual verification tools by route', () => {
    expect(buildVerificationToolNames('chat')).toEqual(['verify_search_again', 'verify_chat_again']);
    expect(buildVerificationToolNames('coding')).toEqual(['verify_search_again', 'verify_code_again']);
    expect(buildVerificationToolNames('search')).toEqual(['verify_search_again']);
    expect(buildVerificationToolNames('creative')).toEqual([]);
  });

  it('formats a readable verification reason from tool calls', () => {
    const reason = buildToolIntentReason([
      { name: 'verify_search_again', args: { focus: 'freshness' } },
      { name: 'verify_code_again', args: {} },
    ]);

    expect(reason).toContain('verify_search_again');
    expect(reason).toContain('focus="freshness"');
    expect(reason).toContain('verify_code_again');
    expect(reason).toContain('no args');
  });

  it('removes tool envelope drafts and keeps plain text answers', () => {
    const envelope = JSON.stringify({
      type: 'tool_calls',
      calls: [{ name: 'verify_search_again', args: { scope: 'latest' } }],
    });

    expect(stripToolEnvelopeDraft(envelope)).toBeNull();
    expect(stripToolEnvelopeDraft(`\`\`\`json\n${envelope}\n\`\`\``)).toBeNull();
    expect(stripToolEnvelopeDraft('  Final verified answer.  ')).toBe('Final verified answer.');
    expect(stripToolEnvelopeDraft('   ')).toBeNull();
  });
});
