import { smartSplit } from '../../shared/text/message-splitter';

type AllowedMentionsPayload = {
  repliedUser?: boolean;
};

type MessagePayload = {
  content: string;
  allowedMentions?: AllowedMentionsPayload;
};

export type ResponseSessionEditableMessage = {
  id: string;
  content?: string;
  edit: (payload: MessagePayload) => Promise<unknown>;
  delete?: () => Promise<unknown>;
  reply?: (payload: MessagePayload) => Promise<ResponseSessionEditableMessage>;
};

export type ResponseSessionReplyAnchor = {
  id: string;
  reply: (payload: MessagePayload) => Promise<ResponseSessionEditableMessage>;
};

export type ResponseSessionChannel = {
  send: (payload: MessagePayload) => Promise<ResponseSessionEditableMessage>;
  messages?: {
    fetch: (messageId: string) => Promise<ResponseSessionEditableMessage>;
  };
};

type ResponseSessionChunkState = {
  primaryMessage: ResponseSessionEditableMessage | null;
  replyAnchor: ResponseSessionReplyAnchor | null;
  overflowMessageIds: string[];
  overflowMessages: ResponseSessionEditableMessage[];
};

export interface ReconcileResponseSessionChunksParams {
  channel: ResponseSessionChannel;
  nextText: string;
  state: ResponseSessionChunkState;
  maxLength?: number;
  allowedMentions?: AllowedMentionsPayload;
}

export interface ReconcileResponseSessionChunksResult {
  primaryMessage: ResponseSessionEditableMessage;
  primaryText: string;
  overflowMessageIds: string[];
  overflowMessages: ResponseSessionEditableMessage[];
}

async function fetchMessageById(
  channel: ResponseSessionChannel,
  messageId: string | null | undefined,
): Promise<ResponseSessionEditableMessage | null> {
  if (!messageId || !channel.messages?.fetch) {
    return null;
  }
  return channel.messages.fetch(messageId).catch(() => null);
}

async function ensureMessageContent(
  message: ResponseSessionEditableMessage,
  content: string,
  allowedMentions?: AllowedMentionsPayload,
): Promise<void> {
  if ((message.content ?? '') === content) {
    return;
  }
  await message.edit({
    content,
    allowedMentions,
  });
  message.content = content;
}

async function deleteMessageIfPresent(
  message: ResponseSessionEditableMessage | null,
): Promise<void> {
  if (!message?.delete) {
    return;
  }
  await message.delete().catch(() => undefined);
}

export interface ReconcileOverflowChunksParams {
  channel: ResponseSessionChannel;
  overflowTexts: string[];
  state: Pick<ResponseSessionChunkState, 'overflowMessageIds' | 'overflowMessages'>;
  allowedMentions?: AllowedMentionsPayload;
  replyAnchor?: ResponseSessionReplyAnchor | ResponseSessionEditableMessage | null;
}

export interface ReconcileOverflowChunksResult {
  overflowMessageIds: string[];
  overflowMessages: ResponseSessionEditableMessage[];
}

function asReplyAnchor(
  value: ResponseSessionReplyAnchor | ResponseSessionEditableMessage | null | undefined,
): ResponseSessionReplyAnchor | null {
  if (!value || typeof value !== 'object' || typeof value.reply !== 'function') {
    return null;
  }
  return {
    id: value.id,
    reply: value.reply.bind(value),
  };
}

export async function reconcileOverflowChunks(
  params: ReconcileOverflowChunksParams,
): Promise<ReconcileOverflowChunksResult> {
  const allowedMentions = params.allowedMentions ?? { repliedUser: false };
  const nextOverflowMessages: ResponseSessionEditableMessage[] = [];
  const nextOverflowMessageIds: string[] = [];

  for (let index = 0; index < params.overflowTexts.length; index += 1) {
    const chunk = params.overflowTexts[index];
    let overflowMessage =
      params.state.overflowMessages[index] ??
      (await fetchMessageById(params.channel, params.state.overflowMessageIds[index]));

    if (!overflowMessage) {
      const replyAnchor =
        asReplyAnchor(nextOverflowMessages[index - 1]) ?? asReplyAnchor(params.replyAnchor);
      overflowMessage = replyAnchor
        ? await replyAnchor.reply({
            content: chunk,
            allowedMentions,
          })
        : await params.channel.send({
            content: chunk,
            allowedMentions,
          });
      overflowMessage.content = chunk;
    } else {
      await ensureMessageContent(overflowMessage, chunk, allowedMentions);
    }

    nextOverflowMessages.push(overflowMessage);
    nextOverflowMessageIds.push(overflowMessage.id);
  }

  for (let index = params.overflowTexts.length; index < params.state.overflowMessageIds.length; index += 1) {
    const overflowMessage =
      params.state.overflowMessages[index] ??
      (await fetchMessageById(params.channel, params.state.overflowMessageIds[index]));
    await deleteMessageIfPresent(overflowMessage);
  }

  params.state.overflowMessages = nextOverflowMessages;
  params.state.overflowMessageIds = nextOverflowMessageIds;

  return {
    overflowMessageIds: nextOverflowMessageIds,
    overflowMessages: nextOverflowMessages,
  };
}

export async function reconcileResponseSessionChunks(
  params: ReconcileResponseSessionChunksParams,
): Promise<ReconcileResponseSessionChunksResult> {
  const chunks = smartSplit(params.nextText, params.maxLength ?? 2_000);
  const [primaryChunk, ...overflowChunks] = chunks;
  const primaryText = primaryChunk || params.nextText;
  const allowedMentions = params.allowedMentions ?? { repliedUser: false };

  let primaryMessage = params.state.primaryMessage;
  if (!primaryMessage) {
    if (params.state.replyAnchor) {
      primaryMessage = await params.state.replyAnchor.reply({
        content: primaryText,
        allowedMentions,
      });
      primaryMessage.content = primaryText;
      params.state.replyAnchor = null;
    } else {
      primaryMessage = await params.channel.send({
        content: primaryText,
        allowedMentions,
      });
      primaryMessage.content = primaryText;
    }
  } else {
    await ensureMessageContent(primaryMessage, primaryText, allowedMentions);
  }

  const overflowResult = await reconcileOverflowChunks({
    channel: params.channel,
    overflowTexts: overflowChunks,
    state: {
      overflowMessageIds: params.state.overflowMessageIds,
      overflowMessages: params.state.overflowMessages,
    },
    allowedMentions,
    replyAnchor: primaryMessage,
  });

  params.state.primaryMessage = primaryMessage;
  params.state.overflowMessages = overflowResult.overflowMessages;
  params.state.overflowMessageIds = overflowResult.overflowMessageIds;

  return {
    primaryMessage,
    primaryText,
    overflowMessageIds: overflowResult.overflowMessageIds,
    overflowMessages: overflowResult.overflowMessages,
  };
}
