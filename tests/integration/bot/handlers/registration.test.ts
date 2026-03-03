/**
 * @module tests/integration/bot/handlers/registration.test
 * @description Defines the registration.test module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Events } from 'discord.js';

const { onMock, listenerCountMock } = vi.hoisted(() => ({
  onMock: vi.fn(),
  listenerCountMock: vi.fn(),
}));

vi.mock('@/bot/client', () => ({
  client: {
    on: onMock,
    listenerCount: listenerCountMock,
    user: { id: 'bot-id' },
  },
}));

import { registerMessageCreateHandler } from '@/bot/handlers/messageCreate';

describe('Handler Registration', () => {
  beforeEach(() => {
    const registrationKey = Symbol.for('sage.handlers.messageCreate.registered');
    const g = globalThis as unknown as { [key: symbol]: unknown };
    delete g[registrationKey];
  });

  it('should register the message create handler exactly once', () => {
    listenerCountMock.mockReturnValue(1);

    registerMessageCreateHandler();
    expect(onMock).toHaveBeenCalledTimes(1);
    expect(onMock).toHaveBeenCalledWith(Events.MessageCreate, expect.any(Function));

    registerMessageCreateHandler();
    expect(onMock).toHaveBeenCalledTimes(1);
  });
});
