import { describe, expect, it } from 'vitest';

import {
  buildLastResortVisibleReply,
  buildRuntimeFailureReply,
  finalizeVisibleReplyText,
} from '@/features/agent-runtime/visibleReply';

describe('visibleReply', () => {
  it('returns the route-aware last-resort fallback when a chat reply is empty', () => {
    const result = finalizeVisibleReplyText({
      replyText: '```json\n{"action":"delete_message"}\n```',
      deliveryDisposition: 'response_session',
      emptyFallback: buildLastResortVisibleReply('turn'),
    });

    expect(result).toContain('Please send me one more message');
  });

  it('returns the route-aware last-resort fallback when no visible reply exists', () => {
    const turnFallback = finalizeVisibleReplyText({
      replyText: '',
      deliveryDisposition: 'response_session',
      emptyFallback: buildLastResortVisibleReply('turn'),
    });
    const continuationFallback = finalizeVisibleReplyText({
      replyText: '',
      deliveryDisposition: 'response_session_with_continue',
      emptyFallback: buildLastResortVisibleReply('continue_prompt'),
    });
    const continuationResumeFallback = finalizeVisibleReplyText({
      replyText: '',
      deliveryDisposition: 'response_session_with_continue',
      emptyFallback: buildLastResortVisibleReply('continue_resume'),
    });
    expect(turnFallback).toContain('Please send me one more message');
    expect(continuationFallback).toContain('press Continue');
    expect(continuationResumeFallback).toContain('another Continue');
  });

  it('returns route-aware runtime failure copy', () => {
    expect(buildRuntimeFailureReply({ kind: 'turn', category: 'provider' })).toBe(
      'I lost the model connection before I could finish, so please try again.',
    );
    expect(buildRuntimeFailureReply({ kind: 'continue_resume', category: 'runtime' })).toBe(
      'I ran into a problem while I was picking that back up, so please press Retry or Continue again.',
    );
  });

  it('prefers a continuation summary over a raw tool-count fallback when the visible reply is empty', () => {
    const result = finalizeVisibleReplyText({
      replyText: 'I checked the relevant GitHub files and still need one more pass to connect the findings.',
      deliveryDisposition: 'response_session_with_continue',
      emptyFallback: buildLastResortVisibleReply('continue_prompt'),
    });

    expect(result).toContain('I checked the relevant GitHub files');
  });

  it('falls back to route-aware copy when response-session text is empty', () => {
    expect(
      finalizeVisibleReplyText({
        replyText: '',
        deliveryDisposition: 'response_session',
        emptyFallback: buildLastResortVisibleReply('turn'),
      }),
    ).toContain('Please send me one more message');
    expect(
      finalizeVisibleReplyText({
        replyText: '',
        deliveryDisposition: 'approval_handoff',
        emptyFallback: buildLastResortVisibleReply('approval_resume'),
      }),
    ).toContain('That review is done');
  });
});
