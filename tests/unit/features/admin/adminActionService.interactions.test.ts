import { describe, expect, it } from 'vitest';
import { discordInteractionRequestSchema } from '@/features/admin/adminActionService';

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

  it('accepts send_message with files and optional content', () => {
    const parsed = discordInteractionRequestSchema.parse({
      action: 'send_message',
      channelId: '<#1234567890>',
      files: [
        {
          filename: 'demo.txt',
          source: { type: 'text', text: 'hello' },
        },
      ],
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        action: 'send_message',
        channelId: '<#1234567890>',
        files: [
          expect.objectContaining({
            filename: 'demo.txt',
          }),
        ],
      }),
    );
  });

  it('rejects send_message when neither content nor files are provided', () => {
    expect(() =>
      discordInteractionRequestSchema.parse({
        action: 'send_message',
        channelId: '<#1234567890>',
      }),
    ).toThrow('requires content or files');
  });
});
