/**
 * @module tests/unit/agentRuntime/discordTool.messagesSendFiles.test
 * @description Defines the discord tool.messages send files.test module.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@/core/agentRuntime/toolRegistry';

const mocks = vi.hoisted(() => ({
  requestDiscordInteractionForTool: vi.fn(),
}));

vi.mock('@/bot/admin/adminActionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/bot/admin/adminActionService')>();
  return {
    ...actual,
    requestDiscordInteractionForTool: mocks.requestDiscordInteractionForTool,
  };
});

import { ToolRegistry } from '@/core/agentRuntime/toolRegistry';
import { registerDefaultAgenticTools } from '@/core/agentRuntime/defaultTools';

describe('discord tool messages.send attachments', () => {
  it('allows non-admin messages.send with files (not autopilot)', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    mocks.requestDiscordInteractionForTool.mockResolvedValue({
      status: 'executed',
      action: 'send_message',
      channelId: 'channel-1',
      messageIds: ['msg-1'],
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
        name: 'discord',
        args: {
          think: 'Send a file attachment',
          action: 'messages.send',
          files: [
            {
              filename: 'demo.txt',
              source: { type: 'text', text: 'hello' },
            },
          ],
        },
      },
      ctx,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(mocks.requestDiscordInteractionForTool).toHaveBeenCalledTimes(1);
    expect(mocks.requestDiscordInteractionForTool).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-1',
        requestedBy: 'user-1',
        invokedBy: 'mention',
        request: expect.objectContaining({
          action: 'send_message',
          channelId: 'channel-1',
          files: [
            expect.objectContaining({
              filename: 'demo.txt',
            }),
          ],
        }),
      }),
    );

    expect(result.result).toEqual(
      expect.objectContaining({
        status: 'executed',
        action: 'send_message',
      }),
    );
  });
});

