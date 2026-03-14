import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildGuildApiKeyWelcomeMessageMock = vi.hoisted(() =>
  vi.fn(() => ({
    flags: 32768,
    components: [{ type: 17 }],
  })),
);

const loggerInfoMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@/features/discord/byopBootstrap', () => ({
  buildGuildApiKeyWelcomeMessage: buildGuildApiKeyWelcomeMessageMock,
}));

vi.mock('@/platform/logging/logger', () => ({
  logger: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
  },
}));

import { handleGuildCreate } from '@/app/discord/handlers/guildCreate';

describe('guildCreate welcome delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes the proactive onboarding message as a Components V2 card', async () => {
    const send = vi.fn(async () => undefined);
    const systemChannel = {
      id: 'channel-1',
      send,
    };
    const guild = {
      id: 'guild-1',
      name: 'Guild One',
      members: { me: null },
      systemChannel,
      channels: {
        cache: {
          find: vi.fn(),
        },
      },
    };

    await handleGuildCreate(guild as never);

    expect(buildGuildApiKeyWelcomeMessageMock).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      flags: 32768,
      components: [{ type: 17 }],
    });
    expect(loggerWarnMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
