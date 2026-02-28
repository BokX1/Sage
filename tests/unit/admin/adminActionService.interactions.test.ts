import { describe, expect, it } from 'vitest';
import { discordInteractionRequestSchema } from '@/bot/admin/adminActionService';

describe('adminActionService interaction schemas', () => {
  it('accepts send_message interaction requests', () => {
    const parsed = discordInteractionRequestSchema.parse({
      action: 'send_message',
      channelId: '<#1234567890>',
      content: '  hello world  ',
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        action: 'send_message',
        channelId: '<#1234567890>',
        content: 'hello world',
      }),
    );
  });
});

