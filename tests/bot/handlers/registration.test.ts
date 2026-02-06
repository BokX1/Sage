import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Events } from 'discord.js';

vi.mock('../../../src/bot/client', () => ({
  client: {
    on: vi.fn(),
    listenerCount: vi.fn(),
    user: { id: 'bot-id' },
  },
}));

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

import { client } from '../../../src/bot/client';
import { registerMessageCreateHandler } from '../../../src/bot/handlers/messageCreate';

describe('Handler Registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset global symbol
    const registrationKey = Symbol.for('sage.handlers.messageCreate.registered');
    delete (globalThis as any)[registrationKey];
  });

  it('should register the message create handler exactly once', () => {
    // cast to any to access mock methods
    (client.listenerCount as any).mockReturnValue(1);

    // First call
    registerMessageCreateHandler();
    expect(client.on).toHaveBeenCalledTimes(1);
    expect(client.on).toHaveBeenCalledWith(Events.MessageCreate, expect.any(Function));

    // Second call
    registerMessageCreateHandler();
    expect(client.on).toHaveBeenCalledTimes(1); // Still 1
  });
});
