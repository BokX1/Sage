import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../../../src/features/agent-runtime/toolRegistry';
import { registerDefaultAgenticTools } from '../../../../src/features/agent-runtime/defaultTools';

describe('default agentic tools', () => {
  it('registers baseline tools and is idempotent', async () => {
    const registry = new ToolRegistry();

    await registerDefaultAgenticTools(registry);
    await registerDefaultAgenticTools(registry);

    const names = registry.listNames();
    expect(names).toEqual(expect.arrayContaining([
      'discord_context_get_channel_summary',
      'discord_history_search_history',
      'discord_artifact_read_attachment',
      'discord_spaces_list_channels',
      'discord_spaces_create_role',
      'discord_voice_get_status',
      'web_search',
      'image_generate',
      'npm_info',
      'system_tool_stats',
      'system_time',
    ]));
    expect(names).not.toContain('discord_admin');
    expect(names).not.toContain('github');
    expect(names).not.toContain('web');
    expect(names).not.toContain('workflow');
  });

  it('marks admin Discord tools as admin access', async () => {
    const registry = new ToolRegistry();
    await registerDefaultAgenticTools(registry);

    const adminTool = registry.get('discord_spaces_create_role');
    expect(adminTool?.runtime.access).toBe('admin');
  });

  it('executes system_time tool', async () => {
    const registry = new ToolRegistry();
    await registerDefaultAgenticTools(registry);

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
        structuredContent: expect.objectContaining({
          isoUtc: expect.any(String),
          unixMs: expect.any(Number),
        }),
      }),
    );
  });

  it('blocks Discord write actions in autopilot turns', async () => {
    const registry = new ToolRegistry();
    await registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord_spaces_create_poll',
        args: {
          action: 'create_poll',
          question: 'Hello from autopilot',
          answers: ['A', 'B'],
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
    await registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord_moderation_submit_action',
        args: {
          action: 'submit_moderation',
          request: {
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
    await registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord_governance_update_server_instructions',
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
