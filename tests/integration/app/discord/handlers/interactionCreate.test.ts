import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import { Events } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChatInputCommandInteraction } from '../../../../testkit/discord';

const onMock = vi.fn();
const handleAdminActionButtonInteraction = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const handleAdminActionRejectModalSubmit = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const handleGuildApiKeyBootstrapButtonInteraction = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const handleGuildApiKeyBootstrapModalSubmit = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const handleInteractiveButtonSession = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const handleInteractiveModalSession = vi.hoisted(() => vi.fn().mockResolvedValue(false));

vi.mock('@/platform/discord/client', () => ({
  client: {
    on: onMock,
    listenerCount: vi.fn().mockReturnValue(1),
  },
}));

vi.mock('@/features/admin/adminActionService', () => ({
  handleAdminActionButtonInteraction,
  handleAdminActionRejectModalSubmit,
}));

vi.mock('@/features/discord/byopBootstrap', () => ({
  handleGuildApiKeyBootstrapButtonInteraction,
  handleGuildApiKeyBootstrapModalSubmit,
}));

vi.mock('@/app/discord/handlers/interactiveSage', () => ({
  handleInteractiveButtonSession,
  handleInteractiveModalSession,
  sendCommandlessNotice: vi.fn(async (interaction: ChatInputCommandInteraction) => {
    await interaction.reply({
      content: 'Sage is chat-first now. Mention me, reply to me, or start with `Sage` instead of using slash commands.',
      ephemeral: true,
    });
  }),
}));

describe('interactionCreate handler', () => {
  beforeEach(() => {
    vi.resetModules();
    onMock.mockReset();
    handleAdminActionButtonInteraction.mockReset().mockResolvedValue(false);
    handleAdminActionRejectModalSubmit.mockReset().mockResolvedValue(false);
    handleGuildApiKeyBootstrapButtonInteraction.mockReset().mockResolvedValue(false);
    handleGuildApiKeyBootstrapModalSubmit.mockReset().mockResolvedValue(false);
    handleInteractiveButtonSession.mockReset().mockResolvedValue(false);
    handleInteractiveModalSession.mockReset().mockResolvedValue(false);
    const registrationKey = Symbol.for('sage.handlers.interactionCreate.registered');
    const g = globalThis as unknown as { [key: symbol]: unknown };
    delete g[registrationKey];
  });

  it('replies with the commandless guidance for any slash command', async () => {
    const { registerInteractionCreateHandler } = await import('@/app/discord/handlers/interactionCreate');
    registerInteractionCreateHandler();

    expect(onMock).toHaveBeenCalledWith(Events.InteractionCreate, expect.any(Function));
    const handler = onMock.mock.calls[0]?.[1] as unknown as (
      interaction: ChatInputCommandInteraction,
    ) => Promise<void>;

    const reply = vi.fn().mockResolvedValue(undefined);
    await handler(
      makeChatInputCommandInteraction({
        commandName: 'ping',
        reply: reply as unknown as ChatInputCommandInteraction['reply'],
      }),
    );

    expect(reply).toHaveBeenCalledWith({
      content: 'Sage is chat-first now. Mention me, reply to me, or start with `Sage` instead of using slash commands.',
      ephemeral: true,
    });
  });

  it('stops after a bootstrap button handler succeeds', async () => {
    handleGuildApiKeyBootstrapButtonInteraction.mockResolvedValueOnce(true);

    const { registerInteractionCreateHandler } = await import('@/app/discord/handlers/interactionCreate');
    registerInteractionCreateHandler();

    const handler = onMock.mock.calls[0]?.[1] as unknown as (
      interaction: ButtonInteraction,
    ) => Promise<void>;

    const interaction = {
      isButton: () => true,
      isChatInputCommand: () => false,
      customId: 'sage:bootstrap:key:set',
      deferred: false,
      replied: false,
      reply: vi.fn(),
      editReply: vi.fn(),
      inGuild: () => true,
    } as unknown as ButtonInteraction;

    await handler(interaction);

    expect(handleAdminActionButtonInteraction).toHaveBeenCalledTimes(1);
    expect(handleGuildApiKeyBootstrapButtonInteraction).toHaveBeenCalledTimes(1);
    expect(handleInteractiveButtonSession).not.toHaveBeenCalled();
  });
});
