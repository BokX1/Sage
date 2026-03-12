import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';
import { registerDefaultAgenticTools } from '../../../../src/features/agent-runtime/defaultTools';

describe('default agentic tools', () => {
  it('registers baseline tools and is idempotent', () => {
    const registry = new ToolRegistry();

    registerDefaultAgenticTools(registry);
    registerDefaultAgenticTools(registry);

    expect(registry.listNames().sort()).toEqual([
      'discord_admin',
      'discord_context',
      'discord_files',
      'discord_messages',
      'discord_server',
      'discord_voice',
      'github',
      'image_generate',
      'npm_info',
      'stack_overflow_search',
      'system_tool_stats',
      'system_time',
      'workflow',
      'web',
      'wikipedia_search',
    ].sort());
  });

  it('marks discord_admin as admin access', () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const adminTool = registry.get('discord_admin');
    expect(adminTool?.metadata?.access).toBe('admin');
  });

  it('executes system_time tool', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'system_time',
        args: {},
      },
      {
        traceId: 'trace',
        userId: 'user',
        channelId: 'channel',
      },
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.result).toEqual(
      expect.objectContaining({
        isoUtc: expect.any(String),
        unixMs: expect.any(Number),
      }),
    );
  });

  it('blocks Discord write actions in autopilot turns', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord_messages',
        args: {
          action: 'send',
          content: 'Hello from autopilot',
        },
      },
      {
        traceId: 'trace',
        userId: 'user',
        channelId: 'channel',
        guildId: 'guild',
        invokedBy: 'autopilot',
      },
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorType).toBe('execution');
    expect(result.error).toContain('autopilot');
  });

  it('rejects non-moderation actions in discord moderation queue', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord_admin',
        args: {
          action: 'submit_moderation',
          request: {
            // wrong schema on purpose: this is an interaction, not a moderation action
            action: 'create_poll',
            question: 'Lunch?',
            answers: ['Pizza', 'Salad'],
          } as never,
        },
      },
      {
        traceId: 'trace',
        userId: 'user',
        channelId: 'channel',
        guildId: 'guild',
        invokedBy: 'mention',
        invokerIsAdmin: true,
      },
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorType).toBe('validation');
  });

  it('allows admin tools for admin mentions/replies/wakewords (not command-only)', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord_admin',
        args: {
          action: 'update_server_instructions',
          request: {
            operation: 'set',
            text: 'Server policy',
            reason: 'Update',
          },
        },
      },
      {
        traceId: 'trace',
        userId: 'user',
        channelId: 'channel',
        invokedBy: 'mention',
        invokerIsAdmin: true,
      },
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorType).toBe('execution');
    expect(result.error).toContain('guild context');
  });
});
