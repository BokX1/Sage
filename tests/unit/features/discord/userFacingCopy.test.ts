import { describe, expect, it } from 'vitest';

import {
  buildInteractionFailureText,
  buildMessageFailureText,
} from '@/features/discord/userFacingCopy';

describe('userFacingCopy', () => {
  it('uses a single-flow interaction failure message', () => {
    expect(buildInteractionFailureText()).toBe(
      'Sage hit a snag while I was handling that action. Try that button or form again. If it keeps happening, ask me to open a fresh flow here.',
    );
  });

  it('uses a single-flow message failure message', () => {
    expect(buildMessageFailureText()).toBe(
      'Sage hit a snag before I could finish that reply. Try again. If it keeps happening, send a fresh message and I will start over from there.',
    );
  });
});
