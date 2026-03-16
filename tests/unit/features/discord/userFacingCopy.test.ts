import { describe, expect, it } from 'vitest';

import {
  buildInteractionFailureText,
  buildMessageFailureText,
} from '@/features/discord/userFacingCopy';

describe('userFacingCopy', () => {
  it('uses a single-flow interaction failure message', () => {
    expect(buildInteractionFailureText()).toBe('I could not handle that action, so please try it again.');
  });

  it('uses a single-flow message failure message', () => {
    expect(buildMessageFailureText()).toBe('I could not finish that reply, so please send it again.');
  });
});
