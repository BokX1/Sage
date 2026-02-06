import { beforeEach, describe, expect, it, vi } from 'vitest';

const processOnceMock = vi.spyOn(process, 'once');
const processOnMock = vi.spyOn(process, 'on');
const processExitMock = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

const stopChannelSummaryScheduler = vi.fn();
const prismaDisconnect = vi.fn();
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock('../../../src/core/summary/channelSummaryScheduler', () => ({
  stopChannelSummaryScheduler,
}));

vi.mock('../../../src/core/db/prisma-client', () => ({
  prisma: {
    $disconnect: prismaDisconnect,
  },
}));

vi.mock('../../../src/core/utils/logger', () => ({
  logger,
}));

describe('registerShutdownHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processOnceMock.mockClear();
    processOnMock.mockClear();
    processExitMock.mockClear();
    stopChannelSummaryScheduler.mockResolvedValue(undefined);
    prismaDisconnect.mockResolvedValue(undefined);
  });

  it('stops scheduler, destroys client, and disconnects prisma on SIGTERM', async () => {
    const { registerShutdownHooks } = await import('../../../src/core/runtime/shutdown');
    const client = { destroy: vi.fn().mockResolvedValue(undefined) } as any;

    registerShutdownHooks({ client });

    const sigtermRegistration = processOnceMock.mock.calls.find((c) => c[0] === 'SIGTERM');
    expect(sigtermRegistration).toBeTruthy();

    (sigtermRegistration?.[1] as () => void)();
    await new Promise((resolve) => setImmediate(resolve));

    expect(stopChannelSummaryScheduler).toHaveBeenCalledTimes(1);
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(prismaDisconnect).toHaveBeenCalledTimes(1);
    expect(processExitMock).toHaveBeenCalledWith(0);
  });
});
