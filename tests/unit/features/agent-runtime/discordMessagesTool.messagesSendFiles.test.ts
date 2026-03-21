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

describe('discord messages tool send attachments', () => {
  it('removes the legacy send_message tool from the model-facing registry', async () => {
    const registry = new ToolRegistry();
    await registerDefaultAgenticTools(registry);

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
        name: 'discord_messages_send',
        args: {},
      },
      ctx,
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorType).toBe('validation');
    expect(result.error).toContain('Unknown tool');
    expect(mocks.requestDiscordInteractionForTool).not.toHaveBeenCalled();
  });

  it('keeps distinct artifact delivery on dedicated artifact tools instead of discord_messages_send', async () => {
    const registry = new ToolRegistry();
    await registerDefaultAgenticTools(registry);

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
        name: 'discord_messages_send',
        args: {},
      },
      ctx,
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorType).toBe('validation');
    expect(result.error).toContain('Unknown tool');
    expect(mocks.requestDiscordInteractionForTool).not.toHaveBeenCalled();
  });
});
