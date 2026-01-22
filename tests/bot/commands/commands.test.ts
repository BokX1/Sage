import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('discord.js', async () => {
  const actual = await vi.importActual<typeof import('discord.js')>('discord.js');

  class MockREST {
    static instances: MockREST[] = [];
    put = vi.fn().mockResolvedValue(undefined);
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

vi.mock('../../../src/utils/logger', () => ({
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
  });

  it('does not include removed model commands', async () => {
    const { commandPayloads } = await import('../../../src/bot/commands');
    const commandNames = commandPayloads.map((command) => command.name);

    const removedCommands = ['models', 'model', 'setmodel', 'resetmodel', 'refreshmodels'];
    for (const name of removedCommands) {
      expect(commandNames).not.toContain(name);
    }

    expect(commandNames).toEqual(expect.arrayContaining(['ping', 'llm_ping', 'sage']));
  });

  it('registers commands without network calls', async () => {
    const { registerCommands, commandPayloads } = await import('../../../src/bot/commands');
    await expect(registerCommands()).resolves.toBeUndefined();

    const { REST } = await import('discord.js');
    const instances = (REST as unknown as { instances?: unknown[] }).instances ?? [];
    expect(instances).toHaveLength(1);

    const restInstance = instances[0] as { put: ReturnType<typeof vi.fn> };
    expect(restInstance.put).toHaveBeenCalledTimes(1);
    expect(restInstance.put).toHaveBeenCalledWith('global-route', { body: commandPayloads });
  });
});
