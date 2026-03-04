import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { logger } from '@/core/utils/logger';
import { ToolRegistry } from '@/core/agentRuntime/toolRegistry';
import { executeToolWithTimeout } from '@/core/agentRuntime/toolCallExecution';

describe('executeToolWithTimeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs execution failures with an explicit errorMessage payload', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'github',
      description: 'Mock GitHub file lookup',
      schema: z.object({}),
      execute: async () => {
        throw new Error('HTTP 404: Not Found');
      },
    });

    const result = await executeToolWithTimeout(
      registry,
      { name: 'github', args: {} },
      {
        traceId: 'trace-1',
        userId: 'user-1',
        channelId: 'channel-1',
      },
      5_000,
    );

    expect(result.success).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-1',
        toolName: 'github',
        errorType: 'execution',
        errorName: 'ToolExecutionError',
        errorMessage: expect.stringContaining('Tool execution failed: HTTP 404: Not Found'),
      }),
      'Tool invocation failed',
    );
  });
});
