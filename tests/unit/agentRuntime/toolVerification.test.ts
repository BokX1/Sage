import { describe, expect, it } from 'vitest';
import {
  buildToolIntentReason,
  buildVerificationToolNames,
  deriveVerificationIntent,
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

  it('derives cross-route verification intent for chat search verification', () => {
    const intent = deriveVerificationIntent('chat', [
      { name: 'verify_search_again', args: { focus: 'freshness' } },
    ]);

    expect(intent.wantsSearchRefresh).toBe(true);
    expect(intent.wantsRouteCrosscheck).toBe(true);
    expect(intent.requestedVirtualTools).toEqual(['verify_search_again']);
    expect(intent.unknownTools).toEqual([]);
  });

  it('tracks unknown verification tools and keeps fallback verification enabled', () => {
    const intent = deriveVerificationIntent('coding', [
      { name: 'verify_not_real', args: { scope: 'x' } },
    ]);

    expect(intent.wantsSearchRefresh).toBe(false);
    expect(intent.wantsRouteCrosscheck).toBe(true);
    expect(intent.requestedVirtualTools).toEqual([]);
    expect(intent.unknownTools).toEqual(['verify_not_real']);
  });

  it('forces search refresh behavior for search route verification envelopes', () => {
    const intent = deriveVerificationIntent('search', [
      { name: 'unknown_verify_tool', args: {} },
    ]);

    expect(intent.wantsSearchRefresh).toBe(true);
    expect(intent.wantsRouteCrosscheck).toBe(true);
  });
});
