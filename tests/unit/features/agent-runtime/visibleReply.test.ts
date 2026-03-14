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

    expect(result).toBe('Completed so far: discord_admin.');
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
      emptyFallback: buildLastResortVisibleReply('continue_resume'),
    });
    const approvalFallback = finalizeVisibleReplyText({
      replyText: '',
      toolResults: [],
      emptyFallback: buildLastResortVisibleReply('approval_resume'),
    });

    expect(turnFallback).toContain('I got to the end of that pass');
    expect(continuationFallback).toContain('I resumed that request');
    expect(approvalFallback).toContain('The review is resolved');
  });

  it('returns route-aware runtime failure copy', () => {
    expect(buildRuntimeFailureReply('turn')).toContain('I hit a runtime issue before I could finish that turn.');
    expect(buildRuntimeFailureReply('continue_resume')).toContain(
      'I hit a runtime issue before I could finish that continuation.',
    );
  });
});
