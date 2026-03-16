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
      deliveryDisposition: 'chat_reply',
      emptyFallback: buildLastResortVisibleReply('turn'),
    });

    expect(result).toContain('I made progress on that');
  });

  it('returns the route-aware last-resort fallback when no visible reply exists', () => {
    const turnFallback = finalizeVisibleReplyText({
      replyText: '',
      deliveryDisposition: 'chat_reply',
      emptyFallback: buildLastResortVisibleReply('turn'),
    });
    const continuationFallback = finalizeVisibleReplyText({
      replyText: '',
      deliveryDisposition: 'chat_reply_with_continue',
      emptyFallback: buildLastResortVisibleReply('continue_prompt'),
    });
    const continuationResumeFallback = finalizeVisibleReplyText({
      replyText: '',
      deliveryDisposition: 'chat_reply_with_continue',
      emptyFallback: buildLastResortVisibleReply('continue_resume'),
    });
    expect(turnFallback).toContain('I made progress on that');
    expect(continuationFallback).toContain('I need another continuation window');
    expect(continuationResumeFallback).toContain('I picked that back up');
  });

  it('returns route-aware runtime failure copy', () => {
    expect(buildRuntimeFailureReply({ kind: 'turn', category: 'provider' })).toBe(
      'The model behind Sage stopped responding before I could finish that reply. Press Retry if it shows up, or send me that request again.',
    );
    expect(buildRuntimeFailureReply({ kind: 'continue_resume', category: 'runtime' })).toBe(
      'Sage hit a snag while I was picking that request back up. Press Retry if it shows up. If not, press Continue again or send me a fresh message.',
    );
  });

  it('prefers a continuation summary over a raw tool-count fallback when the visible reply is empty', () => {
    const result = finalizeVisibleReplyText({
      replyText: 'I checked the relevant GitHub files and still need one more pass to connect the findings.',
      deliveryDisposition: 'chat_reply_with_continue',
      emptyFallback: buildLastResortVisibleReply('continue_prompt'),
    });

    expect(result).toContain('I checked the relevant GitHub files');
  });

  it('allows empty text for tool-delivered and governance-only outcomes', () => {
    expect(
      finalizeVisibleReplyText({
        replyText: '',
        deliveryDisposition: 'tool_delivered',
        emptyFallback: buildLastResortVisibleReply('turn'),
      }),
    ).toBe('');
    expect(
      finalizeVisibleReplyText({
        replyText: '',
        deliveryDisposition: 'approval_governance_only',
        emptyFallback: buildLastResortVisibleReply('approval_resume'),
      }),
    ).toBe('');
  });
});
