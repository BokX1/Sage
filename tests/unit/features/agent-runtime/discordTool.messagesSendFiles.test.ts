import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@/features/agent-runtime/toolRegistry';

const mocks = vi.hoisted(() => ({
  requestDiscordInteractionForTool: vi.fn(),
}));

vi.mock('@/features/admin/adminActionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/admin/adminActionService')>();
  return {
    ...actual,
    requestDiscordInteractionForTool: mocks.requestDiscordInteractionForTool,
  };
});

import { ToolRegistry } from '@/features/agent-runtime/toolRegistry';
import { registerDefaultAgenticTools } from '@/features/agent-runtime/defaultTools';

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

  it('forwards components_v2 presentation payloads to the interaction service', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    mocks.requestDiscordInteractionForTool.mockResolvedValue({
      status: 'executed',
      action: 'send_message',
      channelId: 'channel-1',
      messageIds: ['msg-2'],
      presentation: 'components_v2',
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
          think: 'Send a structured update card',
          action: 'messages.send',
          presentation: 'components_v2',
          files: [
            {
              filename: 'report.png',
              source: { type: 'text', text: 'placeholder' },
            },
          ],
          componentsV2: {
            blocks: [
              { type: 'text', content: '**Release summary**' },
              {
                type: 'section',
                texts: ['Latest checks passed.'],
                accessory: {
                  type: 'thumbnail',
                  media: { attachmentName: 'report.png' },
                },
              },
              { type: 'file', attachmentName: 'report.png' },
            ],
          },
        },
      },
      ctx,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(mocks.requestDiscordInteractionForTool).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          action: 'send_message',
          presentation: 'components_v2',
          componentsV2: expect.objectContaining({
            blocks: expect.arrayContaining([
              expect.objectContaining({ type: 'text' }),
              expect.objectContaining({ type: 'section' }),
              expect.objectContaining({ type: 'file', attachmentName: 'report.png' }),
            ]),
          }),
        }),
      }),
    );

    expect(result.result).toEqual(
      expect.objectContaining({
        presentation: 'components_v2',
      }),
    );
  });
});
