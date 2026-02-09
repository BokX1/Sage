import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('discord.js', async () => {
  const actual = await vi.importActual<typeof import('discord.js')>('discord.js');

  class MockREST {
    static instances: MockREST[] = [];
    static putImpl = vi.fn().mockResolvedValue(undefined);
    put = vi.fn((...args: unknown[]) => MockREST.putImpl(...args));
    token?: string;

    constructor() {
      MockREST.instances.push(this);
    }

    setToken(token: string) {
      this.token = token;
      return this;
    }
  }

  return {
    ...actual,
    REST: MockREST,
    Routes: {
      applicationGuildCommands: vi.fn().mockReturnValue('guild-route'),
      applicationCommands: vi.fn().mockReturnValue('global-route'),
    },
  };
});

vi.mock('../../../src/core/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('Discord command registry', () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    delete process.env.DEV_GUILD_ID;

    const { REST } = await import('discord.js');
    const restCtor = REST as unknown as { instances?: unknown[] };
    if (restCtor.instances) {
      restCtor.instances.length = 0;
    }
    (REST as unknown as { putImpl: ReturnType<typeof vi.fn> }).putImpl = vi.fn().mockResolvedValue(undefined);
  });

  it('does not include removed model commands', async () => {
    const { commandPayloads } = await import('../../../src/bot/commands/slash-command-registry');
    const commandNames = commandPayloads.map((command) => command.name);

    const removedCommands = ['models', 'model', 'setmodel', 'resetmodel', 'refreshmodels'];
    for (const name of removedCommands) {
      expect(commandNames).not.toContain(name);
    }

    expect(commandNames).toEqual(expect.arrayContaining(['ping', 'llm_ping', 'sage']));
  });

  it('registers commands without network calls', async () => {
    process.env.DEV_GUILD_ID = 'test-guild-id';

    const { registerCommands } = await import('../../../src/bot/commands/slash-command-registry');
    await expect(registerCommands()).resolves.toBeUndefined();

    const { REST } = await import('discord.js');
    const instances = (REST as unknown as { instances?: unknown[] }).instances ?? [];
    expect(instances).toHaveLength(1);

    const restInstance = instances[0] as { put: ReturnType<typeof vi.fn> };
    expect(restInstance.put).toHaveBeenCalledTimes(2);
    expect(restInstance.put).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({ body: expect.any(Array) }),
    );
    expect(restInstance.put).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({ body: [] }),
    );
  });

  it('rethrows registration failures after logging', async () => {
    process.env.DEV_GUILD_ID = 'test-guild-id';

    const { registerCommands } = await import('../../../src/bot/commands/slash-command-registry');

    const { REST } = await import('discord.js');
    const instances = (REST as unknown as { instances?: unknown[] }).instances ?? [];
    expect(instances).toHaveLength(0);

    const failure = new Error('network down');
    (REST as unknown as { putImpl: ReturnType<typeof vi.fn> }).putImpl = vi.fn().mockRejectedValue(failure);

    await expect(registerCommands()).rejects.toThrow('network down');
  });

});
