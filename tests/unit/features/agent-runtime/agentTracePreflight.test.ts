import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryRawUnsafeMock = vi.hoisted(() => vi.fn());

vi.mock('@/platform/db/prisma-client', () => ({
  prisma: {
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));

import { assertAgentTraceSchemaReady } from '@/features/agent-runtime/agent-trace-preflight';

describe('assertAgentTraceSchemaReady', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('probes AgentTrace schema', async () => {
    queryRawUnsafeMock.mockResolvedValue([]);

    await assertAgentTraceSchemaReady();

    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);
    expect(String(queryRawUnsafeMock.mock.calls[0][0])).toContain('FROM "AgentTrace"');
  });

  it('throws when AgentTrace probe fails', async () => {
    queryRawUnsafeMock.mockRejectedValueOnce(new Error('column "qualityJson" does not exist'));

    await expect(assertAgentTraceSchemaReady()).rejects.toThrow(
      'AgentTrace schema preflight failed. Run database migrations before startup.',
    );
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);
  });
});
