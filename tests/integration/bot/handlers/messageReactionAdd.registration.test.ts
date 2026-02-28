import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Events } from 'discord.js';

const { onMock, listenerCountMock } = vi.hoisted(() => ({
  onMock: vi.fn(),
  listenerCountMock: vi.fn(),
}));

vi.mock('@/bot/client', () => ({
  client: {
    on: onMock,
    listenerCount: listenerCountMock,
  },
}));

import { registerMessageReactionAddHandler } from '@/bot/handlers/messageReactionAdd';

describe('MessageReactionAdd handler registration', () => {
  beforeEach(() => {
    const registrationKey = Symbol.for('sage.handlers.messageReactionAdd.registered');
    const g = globalThis as unknown as { [key: symbol]: unknown };
    delete g[registrationKey];
  });

  it('registers the reaction add handler exactly once', () => {
    listenerCountMock.mockReturnValue(1);

    registerMessageReactionAddHandler();
    expect(onMock).toHaveBeenCalledTimes(1);
    expect(onMock).toHaveBeenCalledWith(Events.MessageReactionAdd, expect.any(Function));

    registerMessageReactionAddHandler();
    expect(onMock).toHaveBeenCalledTimes(1);
  });
});
