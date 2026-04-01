import type { Client } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stopChannelSummaryScheduler = vi.hoisted(() => vi.fn());
const stopCompactionScheduler = vi.hoisted(() => vi.fn());
const stopAgentTaskRunWorker = vi.hoisted(() => vi.fn());
const stopScheduledTaskWorker = vi.hoisted(() => vi.fn());
const prismaDisconnect = vi.hoisted(() => vi.fn());
const shutdownAgentGraphRuntime = vi.hoisted(() => vi.fn());
const shutdownMcpTools = vi.hoisted(() => vi.fn());

vi.mock('@/features/summary/channelSummaryScheduler', () => ({
  stopChannelSummaryScheduler,
}));

vi.mock('@/features/summary/ltmCompaction', () => ({
  stopCompactionScheduler,
}));

vi.mock('@/features/agent-runtime/agentTaskRunWorker', () => ({
  stopAgentTaskRunWorker,
}));

vi.mock('@/features/scheduler/worker', () => ({
  stopScheduledTaskWorker,
}));

vi.mock('@/platform/db/prisma-client', () => ({
  prisma: {
    $disconnect: prismaDisconnect,
  },
}));

vi.mock('@/features/agent-runtime/langgraph/runtime', () => ({
  shutdownAgentGraphRuntime,
}));

vi.mock('@/features/agent-runtime', () => ({
  shutdownMcpTools,
}));

describe('registerShutdownHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopChannelSummaryScheduler.mockReturnValue(undefined);
    stopCompactionScheduler.mockReturnValue(undefined);
    stopAgentTaskRunWorker.mockReturnValue(undefined);
    stopScheduledTaskWorker.mockReturnValue(undefined);
    prismaDisconnect.mockResolvedValue(undefined);
    shutdownAgentGraphRuntime.mockResolvedValue(undefined);
    shutdownMcpTools.mockResolvedValue(undefined);
  });

  it('stops scheduler, destroys client, and disconnects prisma on SIGTERM', async () => {
    const processOnceMock = vi
      .spyOn(process, 'once')
      .mockImplementation((() => process) as unknown as typeof process.once);
    vi
      .spyOn(process, 'on')
      .mockImplementation((() => process) as unknown as typeof process.on);
    const processExitMock = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as unknown as typeof process.exit);

    const { registerShutdownHooks } = await import('@/app/runtime/shutdown');
    const client = { destroy: vi.fn().mockResolvedValue(undefined) } satisfies Pick<Client, 'destroy'>;

    registerShutdownHooks({ client: client as unknown as Client });

    const sigtermRegistration = processOnceMock.mock.calls.find((c) => c[0] === 'SIGTERM');
    expect(sigtermRegistration).toBeTruthy();

    (sigtermRegistration?.[1] as () => void)();
    await new Promise((resolve) => setImmediate(resolve));

    expect(stopChannelSummaryScheduler).toHaveBeenCalledTimes(1);
    expect(stopCompactionScheduler).toHaveBeenCalledTimes(1);
    expect(stopAgentTaskRunWorker).toHaveBeenCalledTimes(1);
    expect(stopScheduledTaskWorker).toHaveBeenCalledTimes(1);
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(shutdownAgentGraphRuntime).toHaveBeenCalledTimes(1);
    expect(shutdownMcpTools).toHaveBeenCalledTimes(1);
    expect(prismaDisconnect).toHaveBeenCalledTimes(1);
    expect(processExitMock).toHaveBeenCalledWith(0);
  });
});
