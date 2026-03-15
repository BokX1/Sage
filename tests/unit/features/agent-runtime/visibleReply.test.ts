import { describe, expect, it } from 'vitest';

import {
  buildLastResortVisibleReply,
  buildRuntimeFailureReply,
  finalizeVisibleReplyText,
} from '@/features/agent-runtime/visibleReply';

describe('visibleReply', () => {
  it('returns deterministic tool summaries before using the empty fallback', () => {
    const result = finalizeVisibleReplyText({
      replyText: '```json\n{"action":"delete_message"}\n```',
      toolResults: [{ name: 'discord_admin', success: true, latencyMs: 0 }],
      emptyFallback: buildLastResortVisibleReply('turn'),
    });

    expect(result).toBe('Completed so far: 1 tool call (discord_admin).');
  });

  it('returns the route-aware last-resort fallback when no visible reply or tool summary exists', () => {
    const turnFallback = finalizeVisibleReplyText({
      replyText: '',
      toolResults: [],
      emptyFallback: buildLastResortVisibleReply('turn'),
    });
    const continuationFallback = finalizeVisibleReplyText({
      replyText: '',
      toolResults: [],
      emptyFallback: buildLastResortVisibleReply('continue_prompt'),
    });
    const continuationResumeFallback = finalizeVisibleReplyText({
      replyText: '',
      toolResults: [],
      emptyFallback: buildLastResortVisibleReply('continue_resume'),
    });
    const approvalFallback = finalizeVisibleReplyText({
      replyText: '',
      toolResults: [],
      emptyFallback: buildLastResortVisibleReply('approval_resume'),
    });

    expect(turnFallback).toContain('I made progress on that');
    expect(continuationFallback).toContain('I need another continuation window');
    expect(continuationResumeFallback).toContain('I picked that back up');
    expect(approvalFallback).toContain('That review is resolved');
  });

  it('returns route-aware runtime failure copy', () => {
    expect(buildRuntimeFailureReply({ kind: 'turn', category: 'provider' })).toContain(
      'The model behind Sage stopped responding before I could finish that reply.',
    );
    expect(buildRuntimeFailureReply({ kind: 'continue_resume', category: 'runtime' })).toContain(
      'Sage hit a snag while I was picking that request back up.',
    );
  });
});
