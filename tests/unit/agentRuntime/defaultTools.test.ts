/**
 * @module tests/unit/agentRuntime/defaultTools.test
 * @description Defines the default tools.test module.
 */
import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../../src/core/agentRuntime/toolRegistry';
import { registerDefaultAgenticTools } from '../../../src/core/agentRuntime/defaultTools';

describe('default agentic tools', () => {
  it('registers baseline tools and is idempotent', () => {
    const registry = new ToolRegistry();

    registerDefaultAgenticTools(registry);
    registerDefaultAgenticTools(registry);

    expect(registry.listNames().sort()).toEqual([
      'discord',
      'github_get_file',
      'github_repo',
      'github_search_code',
      'image_generate',
      'npm_info',
      'stack_overflow_search',
      'system_time',
      'system_plan',
      'web_scrape',
      'web_read',
      'web_search',
      'wikipedia_search',
    ].sort());
  });

  it('executes system_time tool', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'system_time',
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

  it('blocks Discord write actions in autopilot turns', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'discord',
        args: {
          think: 'Verify autopilot guard',
          action: 'messages.send',
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
        name: 'discord',
        args: {
          think: 'Should fail schema validation',
          action: 'moderation.submit',
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
        name: 'discord',
        args: {
          think: 'Verify non-command admin context is allowed to reach guild guard',
          action: 'memory.update_server',
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
