import { ChannelType, type AnyThreadChannel, type Message, type TextBasedChannel } from 'discord.js';
import { client } from '../../platform/discord/client';
import { logger } from '../../platform/logging/logger';
import {
  findLatestTaskRunBySourceMessageId,
  type AgentTaskRunRecord,
} from '../agent-runtime/agentTaskRunRepo';
import {
  getGuildChannelInvokePolicy,
  isSupportedThreadAutoArchiveDuration,
} from '../settings/guildChannelInvokePolicyRepo';

type RoutedChannel = TextBasedChannel & {
  id: string;
  sendTyping: () => Promise<unknown>;
  send: (payload: unknown) => Promise<unknown>;
};

export interface InvokeThreadRoutingResult {
  originChannelId: string;
  responseChannelId: string;
  responseChannel: RoutedChannel;
  responseThreadId: string | null;
  threadCreated: boolean;
  fallbackReason: string | null;
}

function sanitizeThreadName(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  const next = collapsed.length > 0 ? collapsed : 'Sage request';
  return next.slice(0, 100);
}

function buildThreadName(invokeText: string): string {
  const firstLine = invokeText.split(/\r?\n/, 1)[0] ?? '';
  const sanitized = sanitizeThreadName(firstLine);
  return sanitized.length > 0 && sanitized !== 'Sage request'
    ? sanitizeThreadName(`Sage • ${sanitized}`)
    : 'Sage request';
}

function isThreadChannel(value: unknown): value is AnyThreadChannel {
  return !!value && typeof value === 'object' && typeof (value as { isThread?: () => boolean }).isThread === 'function' && (value as { isThread: () => boolean }).isThread();
}

function isEligibleParentChannel(channel: Message['channel']): channel is Message<true>['channel'] & RoutedChannel {
  return channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
}

async function fetchMessageThread(message: Message): Promise<AnyThreadChannel | null> {
  if (message.thread) {
    return message.thread;
  }
  if (!message.hasThread) {
    return null;
  }
  const fetched = await client.channels.fetch(message.id).catch(() => null);
  return isThreadChannel(fetched) ? fetched : null;
}

async function ensureReusableThread(thread: AnyThreadChannel): Promise<AnyThreadChannel | null> {
  if (!thread.archived) {
    return thread;
  }
  if (thread.locked) {
    return null;
  }
  return await thread.setArchived(false, 'sage: reopen invoke thread').catch(() => null);
}

async function resolvePersistedTaskThread(params: {
  message: Message;
  sourceMessageId: string;
}): Promise<{ run: AgentTaskRunRecord; channel: RoutedChannel } | null> {
  const run = await findLatestTaskRunBySourceMessageId({
    guildId: params.message.guildId ?? null,
    sourceMessageId: params.sourceMessageId,
    requestedByUserId: params.message.author.id,
    statuses: ['running', 'waiting_user_input'],
  });
  if (!run) {
    return null;
  }

  const fetched = await client.channels.fetch(run.responseChannelId).catch(() => null);
  if (!fetched || !('isTextBased' in fetched) || typeof fetched.isTextBased !== 'function' || !fetched.isTextBased()) {
    return null;
  }
  if (isThreadChannel(fetched)) {
    const reusable = await ensureReusableThread(fetched);
    if (!reusable) {
      return null;
    }
    return { run, channel: reusable as unknown as RoutedChannel };
  }
  return { run, channel: fetched as RoutedChannel };
}

export async function resolveInvokeResponseSurface(params: {
  message: Message;
  invokeText: string;
}): Promise<InvokeThreadRoutingResult> {
  const originChannelId = params.message.channelId;
  const originChannel = params.message.channel as RoutedChannel;

  if (!params.message.guildId) {
    return {
      originChannelId,
      responseChannelId: originChannelId,
      responseChannel: originChannel,
      responseThreadId: null,
      threadCreated: false,
      fallbackReason: null,
    };
  }

  if (isThreadChannel(params.message.channel)) {
    return {
      originChannelId,
      responseChannelId: params.message.channel.id,
      responseChannel: params.message.channel as unknown as RoutedChannel,
      responseThreadId: params.message.channel.id,
      threadCreated: false,
      fallbackReason: null,
    };
  }

  const persisted = await resolvePersistedTaskThread({
    message: params.message,
    sourceMessageId: params.message.reference?.messageId ?? params.message.id,
  });
  if (persisted) {
    return {
      originChannelId,
      responseChannelId: persisted.run.responseChannelId,
      responseChannel: persisted.channel,
      responseThreadId: isThreadChannel(persisted.channel) ? persisted.channel.id : null,
      threadCreated: false,
      fallbackReason: null,
    };
  }

  if (!isEligibleParentChannel(params.message.channel)) {
    return {
      originChannelId,
      responseChannelId: originChannelId,
      responseChannel: originChannel,
      responseThreadId: null,
      threadCreated: false,
      fallbackReason: 'unsupported_channel_type',
    };
  }

  const policy = await getGuildChannelInvokePolicy(params.message.guildId, params.message.channelId);
  if (!policy) {
    return {
      originChannelId,
      responseChannelId: originChannelId,
      responseChannel: originChannel,
      responseThreadId: null,
      threadCreated: false,
      fallbackReason: null,
    };
  }

  const existingThread = await fetchMessageThread(params.message);
  if (existingThread) {
    const reusable = await ensureReusableThread(existingThread);
    if (reusable) {
      return {
        originChannelId,
        responseChannelId: reusable.id,
        responseChannel: reusable as unknown as RoutedChannel,
        responseThreadId: reusable.id,
        threadCreated: false,
        fallbackReason: null,
      };
    }
    return {
      originChannelId,
      responseChannelId: originChannelId,
      responseChannel: originChannel,
      responseThreadId: null,
      threadCreated: false,
      fallbackReason: 'existing_thread_unusable',
    };
  }

  try {
    const createdThread = await params.message.startThread({
      name: buildThreadName(params.invokeText),
      ...(isSupportedThreadAutoArchiveDuration(policy.autoArchiveDurationMinutes)
        ? { autoArchiveDuration: policy.autoArchiveDurationMinutes }
        : {}),
      reason: 'sage: thread-on-invoke routing',
    });
    return {
      originChannelId,
      responseChannelId: createdThread.id,
      responseChannel: createdThread as unknown as RoutedChannel,
      responseThreadId: createdThread.id,
      threadCreated: true,
      fallbackReason: null,
    };
  } catch (error) {
    logger.warn(
      {
        error,
        guildId: params.message.guildId,
        channelId: params.message.channelId,
        messageId: params.message.id,
      },
      'Failed to create thread-on-invoke response surface; falling back to the parent channel',
    );
    return {
      originChannelId,
      responseChannelId: originChannelId,
      responseChannel: originChannel,
      responseThreadId: null,
      threadCreated: false,
      fallbackReason: 'thread_create_failed',
    };
  }
}
