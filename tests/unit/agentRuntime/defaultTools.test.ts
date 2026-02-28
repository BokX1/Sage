import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../../src/core/agentRuntime/toolRegistry';
import { registerDefaultAgenticTools } from '../../../src/core/agentRuntime/defaultTools';

describe('default agentic tools', () => {
  it('registers baseline tools and is idempotent', () => {
    const registry = new ToolRegistry();

    registerDefaultAgenticTools(registry);
    registerDefaultAgenticTools(registry);

    expect(registry.listNames().sort()).toEqual([
      'web_extract',
      'discord_lookup_channel_files',
      'discord_lookup_server_files',
      'discord_get_channel_message',
      'discord_queue_moderation_action',
      'discord_execute_interaction',
      'image_generate',
      'discord_get_channel_memory',
      'system_get_current_datetime',
      'discord_get_server_memory',
      'discord_get_social_graph',
      'discord_get_user_memory',
      'discord_get_voice_analytics',
      'discord_get_voice_session_summaries',
      'github_search_code',
      'github_get_file',
      'github_get_repository',
      'system_internal_reflection',
      'npm_get_package',
      'discord_queue_server_memory_update',
      'discord_search_channel_files',
      'discord_search_server_files',
      'discord_search_channel_archived_summaries',
      'discord_search_channel_messages',
      'stack_overflow_search',
      'web_get_page_text',
      'web_search',
      'wikipedia_search',
    ].sort());
  });

  it('executes system_get_current_datetime tool', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'system_get_current_datetime',
        args: { think: 'Testing datetime execution' },
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

  it('blocks discord_execute_interaction in autopilot turns', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord_execute_interaction',
        args: {
          think: 'Verify autopilot guard',
          request: {
            action: 'create_poll',
            question: 'Lunch?',
            answers: ['Pizza', 'Salad'],
          },
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

  it('rejects non-moderation actions in discord_queue_moderation_action', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord_queue_moderation_action',
        args: {
          think: 'Should fail schema validation',
          request: {
            action: 'create_poll',
            question: 'Lunch?',
            answers: ['Pizza', 'Salad'],
          },
        },
      },
      {
        traceId: 'trace',
        userId: 'user',
        channelId: 'channel',
        guildId: 'guild',
        invokedBy: 'command',
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
        name: 'discord_queue_server_memory_update',
        args: {
          think: 'Verify non-command admin context is allowed to reach guild guard',
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
