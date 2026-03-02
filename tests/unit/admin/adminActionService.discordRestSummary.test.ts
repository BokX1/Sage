import { describe, expect, it } from 'vitest';
import { buildDiscordRestWriteSummary, type DiscordRestWriteRequest } from '@/bot/admin/adminActionService';

describe('buildDiscordRestWriteSummary', () => {
  it('avoids leaking raw query/body values and strips file URL query strings', () => {
    const request: DiscordRestWriteRequest = {
      method: 'POST',
      path: '/channels/123/messages',
      reason: 'Bearer super-secret-token',
      query: {
        limit: 1,
        token: 'super-secret-query',
      },
      body: {
        content: 'super-secret-body',
        embeds: [],
      },
      files: [
        {
          filename: 'test.txt',
          source: {
            type: 'url',
            url: 'https://files.example/test.txt?X-Amz-Signature=abc123&token=super-secret#frag',
          },
        },
      ],
    };

    const summary = buildDiscordRestWriteSummary(request).join('\n');

    expect(summary).toContain('Method: POST');
    expect(summary).toContain('Path: /channels/123/messages');
    expect(summary).toContain('Query keys:');
    expect(summary).toContain('token');
    expect(summary).not.toContain('super-secret-query');
    expect(summary).not.toContain('super-secret-body');
    expect(summary).toContain('Bearer [REDACTED]');
    expect(summary).toContain('https://files.example/test.txt');
    expect(summary).not.toContain('X-Amz-Signature');
    expect(summary).not.toContain('?');
  });
});

