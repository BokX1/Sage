import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../../src/core/agentRuntime/toolRegistry';
import { registerDefaultAgenticTools } from '../../../src/core/agentRuntime/defaultTools';

describe('default agentic tools', () => {
  it('registers baseline tools and is idempotent', () => {
    const registry = new ToolRegistry();

    registerDefaultAgenticTools(registry);
    registerDefaultAgenticTools(registry);

    expect(registry.listNames().sort()).toEqual([
      'channel_file_lookup',
      'get_current_datetime',
      'github_file_lookup',
      'github_repo_lookup',
      'local_llm_infer',
      'local_llm_models',
      'npm_package_lookup',
      'stack_overflow_search',
      'web_scrape',
      'web_search',
      'wikipedia_lookup',
    ]);
  });

  it('executes get_current_datetime tool', async () => {
    const registry = new ToolRegistry();
    registerDefaultAgenticTools(registry);

    const result = await registry.executeValidated(
      {
        name: 'get_current_datetime',
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
});
