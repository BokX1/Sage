/**
 * @module tests/testkit/discord
 * @description Defines the discord module.
 */
import type { ChatInputCommandInteraction, Message, TextChannel, User } from 'discord.js';
import { vi } from 'vitest';

/**
 * Runs makeUser.
 *
 * @param overrides - Describes the overrides input.
 * @returns Returns the function result.
 */
export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    bot: false,
    username: 'user',
    ...overrides,
  } as unknown as User;
}

/**
 * Runs makeTextChannel.
 *
 * @param overrides - Describes the overrides input.
 * @returns Returns the function result.
 */
export function makeTextChannel(overrides: Partial<TextChannel> = {}): TextChannel {
  return {
    send: vi.fn(),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TextChannel;
}

/**
 * Runs makeMessage.
 *
 * @param overrides - Describes the overrides input.
 * @returns Returns the function result.
 */
export function makeMessage(overrides: Partial<Message> = {}): Message {
  const author = makeUser();
  const channel = makeTextChannel();

  return {
    id: 'msg-1',
    content: '',
    author,
    channel,
    channelId: 'channel-1',
    guildId: 'guild-1',
    createdAt: new Date(0),
    mentions: {
      has: vi.fn(() => false),
      users: new Map(),
    },
    attachments: {
      first: vi.fn(() => null),
      values: vi.fn(() => []),
    },
    reference: null,
    fetchReference: vi.fn(),
    ...overrides,
  } as unknown as Message;
}

type ChatInputCommandInteractionOverrides = Partial<
  Omit<ChatInputCommandInteraction, 'valueOf'>
>;

/**
 * Runs makeChatInputCommandInteraction.
 *
 * @param overrides - Describes the overrides input.
 * @returns Returns the function result.
 */
export function makeChatInputCommandInteraction(
  overrides: ChatInputCommandInteractionOverrides = {},
): ChatInputCommandInteraction {
  return {
    isChatInputCommand: () => true,
    isRepliable: () => true,
    commandName: 'ping',
    deferred: false,
    replied: false,
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    options: {
      getSubcommandGroup: () => null,
      getSubcommand: () => '',
    } as unknown as ChatInputCommandInteraction['options'],
    ...overrides,
  } as unknown as ChatInputCommandInteraction;
}
