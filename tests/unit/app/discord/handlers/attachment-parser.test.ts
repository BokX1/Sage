/**
 * @description Validates attachment parser visible-text and vision-url extraction behavior.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsPrivateOrLocalHostname = vi.hoisted(() => vi.fn(() => false));

vi.mock('@/platform/config/env', () => ({
  isPrivateOrLocalHostname: mockIsPrivateOrLocalHostname,
}));

import {
  extractVisibleMessageText,
  getVisionImageUrl,
} from '../../../../../src/app/discord/handlers/attachment-parser';

function createMockMessage(overrides: Record<string, unknown> = {}) {
  return {
    content: '',
    attachments: {
      first: vi.fn(() => null),
      values: vi.fn(() => []),
    },
    ...overrides,
  };
}

describe('attachment-parser getVisionImageUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPrivateOrLocalHostname.mockReturnValue(false);
  });

  it('uses sticker URLs as vision input when available', () => {
    const message = createMockMessage({
      stickers: {
        values: vi.fn(() => [
          { url: 'https://media.discordapp.net/stickers/example.webp' },
        ]),
      },
    });

    expect(getVisionImageUrl(message as unknown as Parameters<typeof getVisionImageUrl>[0])).toBe(
      'https://media.discordapp.net/stickers/example.webp',
    );
  });

  it('trims trailing punctuation from direct image URLs in message content', () => {
    const message = createMockMessage({
      content: 'look at this https://example.com/direct.png.',
    });

    expect(getVisionImageUrl(message as unknown as Parameters<typeof getVisionImageUrl>[0])).toBe(
      'https://example.com/direct.png',
    );
  });
});

describe('attachment-parser extractVisibleMessageText', () => {
  it('includes embed text when raw content is empty', () => {
    const message = createMockMessage({
      embeds: [
        {
          author: { name: 'Sage (AI)' },
          title: 'Approval Result',
          description: 'The update is complete.',
          fields: [
            { name: 'Outcome', value: 'Success' },
          ],
          footer: { text: 'Done' },
        },
      ],
    });

    expect(extractVisibleMessageText(message as never)).toBe(
      ['Sage (AI)', 'Approval Result', 'The update is complete.', 'Outcome', 'Success', 'Done'].join('\n\n'),
    );
  });

  it('includes Components V2 text display content but skips button labels', () => {
    const message = createMockMessage({
      components: [
        {
          type: 17,
          components: [
            {
              type: 10,
              content: 'Sage finished the approval flow.',
            },
            {
              type: 1,
              components: [
                {
                  type: 2,
                  label: 'Continue',
                },
              ],
            },
          ],
        },
      ],
    });

    expect(extractVisibleMessageText(message as never)).toBe('Sage finished the approval flow.');
  });
});
