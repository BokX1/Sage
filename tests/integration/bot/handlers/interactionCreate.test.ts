import type { ChatInputCommandInteraction } from 'discord.js';
import { Events } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChatInputCommandInteraction } from '../../../testkit/discord';

const onMock = vi.fn();

vi.mock('@/bot/client', () => ({
  client: {
    on: onMock,
    listenerCount: vi.fn().mockReturnValue(1),
  },
}));

vi.mock('@/bot/handlers/sage-command-handlers', () => ({
  handleAdminStats: vi.fn(),
}));
vi.mock('@/bot/commands/api-key-handlers', () => ({
  handleKeyCheck: vi.fn(),
  handleKeyClear: vi.fn(),
  handleKeyLogin: vi.fn(),
  handleKeySet: vi.fn(),
}));
vi.mock('@/bot/commands/voice-channel-handlers', () => ({
  handleJoinCommand: vi.fn(),
  handleLeaveCommand: vi.fn(),
}));

describe('interactionCreate handler', () => {
  beforeEach(() => {
    vi.resetModules();
    onMock.mockReset();
    const registrationKey = Symbol.for('sage.handlers.interactionCreate.registered');
    const g = globalThis as unknown as { [key: symbol]: unknown };
    delete g[registrationKey];
  });

  it('replies safely for unknown root commands', async () => {
    const { registerInteractionCreateHandler } = await import('@/bot/handlers/interactionCreate');
    registerInteractionCreateHandler();

    expect(onMock).toHaveBeenCalledWith(Events.InteractionCreate, expect.any(Function));
    const handler = onMock.mock.calls[0]?.[1] as unknown as (
      interaction: ChatInputCommandInteraction,
    ) => Promise<void>;

    const reply = vi.fn().mockResolvedValue(undefined);
    await handler(
      makeChatInputCommandInteraction({
        commandName: 'unknown-root',
        reply: reply as unknown as ChatInputCommandInteraction['reply'],
      }),
    );

    expect(reply).toHaveBeenCalledWith({
      content: 'Unknown command.',
      ephemeral: true,
    });
  });

  it('edits deferred interactions with a safe payload after command errors', async () => {
    const voiceHandlers = await import('@/bot/commands/voice-channel-handlers');
    vi.mocked(voiceHandlers.handleJoinCommand).mockRejectedValueOnce(new Error('join failed'));

    const { registerInteractionCreateHandler } = await import('@/bot/handlers/interactionCreate');
    registerInteractionCreateHandler();

    expect(onMock).toHaveBeenCalledWith(Events.InteractionCreate, expect.any(Function));
    const handler = onMock.mock.calls[0]?.[1] as unknown as (
      interaction: ChatInputCommandInteraction,
    ) => Promise<void>;

    const editReply = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handler(
      makeChatInputCommandInteraction({
        commandName: 'join',
        deferred: true,
        editReply: editReply as unknown as ChatInputCommandInteraction['editReply'],
        reply: reply as unknown as ChatInputCommandInteraction['reply'],
      }),
    );

    expect(editReply).toHaveBeenCalledWith({ content: 'Something went wrong.' });
    expect(reply).not.toHaveBeenCalled();
  });

  it('uses editReply for unknown subcommands when interaction is already deferred', async () => {
    const { registerInteractionCreateHandler } = await import('@/bot/handlers/interactionCreate');
    registerInteractionCreateHandler();

    expect(onMock).toHaveBeenCalledWith(Events.InteractionCreate, expect.any(Function));
    const handler = onMock.mock.calls[0]?.[1] as unknown as (
      interaction: ChatInputCommandInteraction,
    ) => Promise<void>;

    const editReply = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);

    await handler(
      makeChatInputCommandInteraction({
        commandName: 'sage',
        deferred: true,
        editReply: editReply as unknown as ChatInputCommandInteraction['editReply'],
        reply: reply as unknown as ChatInputCommandInteraction['reply'],
        options: {
          getSubcommandGroup: vi.fn(() => null),
          getSubcommand: vi.fn(() => 'unknown'),
        } as unknown as ChatInputCommandInteraction['options'],
      }),
    );

    expect(editReply).toHaveBeenCalledWith({ content: 'Unknown subcommand.' });
    expect(reply).not.toHaveBeenCalled();
  });
});
