import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@/features/agent-runtime/toolRegistry';

const mocks = vi.hoisted(() => ({
  sendCachedAttachment: vi.fn(),
}));

vi.mock('@/features/agent-runtime/toolIntegrations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/agent-runtime/toolIntegrations')>();
  return {
    ...actual,
    sendCachedAttachment: mocks.sendCachedAttachment,
  };
});

import { ToolRegistry } from '@/features/agent-runtime/toolRegistry';
import { registerDefaultAgenticTools } from '@/features/agent-runtime/defaultTools';

describe('discord files tool send_attachment', () => {
  it('allows non-admin resend requests outside autopilot and returns stored grounding text', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    mocks.sendCachedAttachment.mockResolvedValue({
      found: true,
      attachmentId: 'att-1',
      sendResult: { status: 'executed', action: 'send_message' },
      storedContentReadable: true,
      storedContent: 'Image summary: cat meme',
    });

    const ctx: ToolExecutionContext = {
      traceId: 'trace',
      userId: 'user-1',
      channelId: 'channel-1',
      guildId: 'guild-1',
      invokedBy: 'mention',
      invokerIsAdmin: false,
    };

    const result = await registry.executeValidated(
      {
        name: 'discord_files_send_attachment',
        args: {
          attachmentId: 'att-1',
          channelId: 'channel-2',
          content: 'Here it is.',
        },
      },
      ctx,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(mocks.sendCachedAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        requesterUserId: 'user-1',
        requesterChannelId: 'channel-1',
        invokedBy: 'mention',
        attachmentId: 'att-1',
        channelId: 'channel-2',
        content: 'Here it is.',
      }),
    );
    expect(result.result).toEqual(
      expect.objectContaining({
        structuredContent: expect.objectContaining({
          found: true,
          storedContent: 'Image summary: cat meme',
        }),
      }),
    );
  });
});
