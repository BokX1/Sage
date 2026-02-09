import { describe, expect, it } from 'vitest';
import { stripToolEnvelopeDraft } from '../../../src/core/agentRuntime/toolVerification';

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
});
