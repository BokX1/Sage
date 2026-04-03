import { z } from 'zod';
import {
  hasAuthorityAtLeast,
  type DiscordAuthorityTier,
} from '../../../platform/discord/admin-permissions';
import { PermissionsBitField, type Guild, type GuildBasedChannel } from 'discord.js';
import { client } from '../../../platform/discord/client';
import { filterChannelIdsByMemberAccess, type ChannelPermissionRequirement } from '../../../platform/discord/channel-access';
import type { BridgeAccess, BridgeMethodDefinition } from './types';
import type { ToolExecutionContext } from '../../agent-runtime/runtimeToolContract';

const READ_HISTORY_REQUIREMENTS: ChannelPermissionRequirement[] = [
  { flag: PermissionsBitField.Flags.ViewChannel, label: 'ViewChannel' },
  { flag: PermissionsBitField.Flags.ReadMessageHistory, label: 'ReadMessageHistory' },
];

const SEND_MESSAGE_REQUIREMENTS: ChannelPermissionRequirement[] = [
  { flag: PermissionsBitField.Flags.ViewChannel, label: 'ViewChannel' },
  { flag: PermissionsBitField.Flags.SendMessages, label: 'SendMessages' },
];

export function toBridgeMethodKey(namespace: string, method: string): string {
  return `${namespace.trim()}.${method.trim()}`;
}

export function defineBridgeMethod<TArgs>(definition: BridgeMethodDefinition<TArgs>): BridgeMethodDefinition<TArgs> {
  return definition;
}

export function assertBridgeAccess(
  toolContext: ToolExecutionContext,
  requiredAccess: BridgeAccess | undefined,
): void {
  const required = requiredAccess ?? 'public';
  const authority = toolContext.invokerAuthority ?? 'member';
  const normalizedRequired = required === 'public' ? 'member' : required;
  if (!hasAuthorityAtLeast(authority, normalizedRequired as DiscordAuthorityTier)) {
    throw new Error(`This operation requires ${required} access.`);
  }
}

export function requireGuildId(toolContext: ToolExecutionContext): string {
  const guildId = toolContext.guildId?.trim();
  if (!guildId) {
    throw new Error('This operation requires guild context.');
  }
  return guildId;
}

export async function fetchGuildFromContext(toolContext: ToolExecutionContext): Promise<Guild> {
  const guildId = requireGuildId(toolContext);
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    throw new Error('Guild is unavailable.');
  }
  return guild;
}

export async function assertReadableChannelAccess(params: {
  toolContext: ToolExecutionContext;
  channelIds: string[];
}): Promise<void> {
  const guildId = requireGuildId(params.toolContext);
  const userId = params.toolContext.userId;
  const allowed = await filterChannelIdsByMemberAccess({
    guildId,
    userId,
    channelIds: params.channelIds,
    requirements: READ_HISTORY_REQUIREMENTS,
  });
  for (const channelId of params.channelIds) {
    if (!allowed.has(channelId)) {
      throw new Error(`You do not have access to channel "${channelId}".`);
    }
  }
}

export async function assertWritableChannelAccess(params: {
  toolContext: ToolExecutionContext;
  channelId: string;
}): Promise<void> {
  const guildId = requireGuildId(params.toolContext);
  const allowed = await filterChannelIdsByMemberAccess({
    guildId,
    userId: params.toolContext.userId,
    channelIds: [params.channelId],
    requirements: SEND_MESSAGE_REQUIREMENTS,
  });
  if (!allowed.has(params.channelId)) {
    throw new Error(`You cannot send messages to channel "${params.channelId}".`);
  }
}

export async function fetchGuildChannel(params: {
  toolContext: ToolExecutionContext;
  channelId: string;
}): Promise<GuildBasedChannel> {
  const guild = await fetchGuildFromContext(params.toolContext);
  const channel = await guild.channels.fetch(params.channelId).catch(() => null);
  if (!channel) {
    throw new Error(`Channel "${params.channelId}" was not found.`);
  }
  return channel;
}

export async function fetchWritableTextChannel(params: {
  toolContext: ToolExecutionContext;
  channelId: string;
}): Promise<GuildBasedChannel & {
  send: (payload: string | { content: string }) => Promise<{ id: string; content: string; createdAt: Date }>;
  messages: {
    fetch: (messageId: string) => Promise<{
      id: string;
      content: string;
      createdAt: Date;
      reply: (payload: string | { content: string }) => Promise<{ id: string; content: string; createdAt: Date }>;
      react: (emoji: string) => Promise<unknown>;
    }>;
  };
}> {
  await assertWritableChannelAccess(params);
  const channel = await fetchGuildChannel(params);
  if (!channel.isTextBased?.()) {
    throw new Error(`Channel "${params.channelId}" is not text-based.`);
  }
  const candidate = channel as GuildBasedChannel & {
    send?: unknown;
    messages?: {
      fetch?: unknown;
    };
  };
  if (typeof candidate.send !== 'function' || !candidate.messages || typeof candidate.messages.fetch !== 'function') {
    throw new Error(`Channel "${params.channelId}" does not support message operations.`);
  }
  return candidate as GuildBasedChannel & {
    send: (payload: string | { content: string }) => Promise<{ id: string; content: string; createdAt: Date }>;
    messages: {
      fetch: (messageId: string) => Promise<{
        id: string;
        content: string;
        createdAt: Date;
        reply: (payload: string | { content: string }) => Promise<{ id: string; content: string; createdAt: Date }>;
        react: (emoji: string) => Promise<unknown>;
      }>;
    };
  };
}

export function makeOptionalStringSchema(max = 4_000) {
  return z.string().trim().min(1).max(max).optional();
}
