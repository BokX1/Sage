import { ChannelMessage } from '../awareness/awareness-types';
import { LLMContentPart, LLMMessageContent } from '../../platform/llm/llm-types';

export type InvocationKind = 'mention' | 'reply' | 'wakeword' | 'autopilot' | 'component';

export interface CurrentTurnContext {
  invokerUserId: string;
  invokerDisplayName: string;
  messageId: string;
  guildId: string | null;
  channelId: string;
  invokedBy: InvocationKind;
  mentionedUserIds: string[];
  isDirectReply: boolean;
  replyTargetMessageId?: string | null;
  replyTargetAuthorId?: string | null;
  botUserId?: string | null;
}

export interface ReplyTargetContext {
  messageId: string;
  guildId: string | null;
  channelId: string;
  authorId: string;
  authorDisplayName: string;
  authorIsBot: boolean;
  replyToMessageId?: string | null;
  mentionedUserIds: string[];
  content: LLMMessageContent;
}

export interface SelectFocusedContinuityMessagesParams {
  messages: ChannelMessage[];
  currentTurn: CurrentTurnContext;
  replyTarget?: ReplyTargetContext | null;
  excludedMessageIds?: Iterable<string>;
  maxSameSpeakerMessages?: number;
  maxReplyNeighborMessages?: number;
}

function isSystemMessage(message: ChannelMessage): boolean {
  return message.authorId === 'SYSTEM';
}

function shouldSkipMessage(message: ChannelMessage): boolean {
  return isSystemMessage(message) || message.content.trim().length === 0;
}

export function extractTextFromMessageContent(content: LLMMessageContent | null | undefined): string | null {
  if (!content) {
    return null;
  }
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  const text = content
    .filter((part): part is Extract<LLMContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text.trim())
    .filter((part) => part.length > 0)
    .join('\n');

  return text.length > 0 ? text : null;
}

export function describeContinuityPolicy(invokedBy: InvocationKind): string {
  switch (invokedBy) {
    case 'reply':
      return 'reply_target > same_speaker_recent > explicit_named_subject > ambient_room';
    case 'component':
      return 'component_payload > current_invoker_context > explicit_named_subject > ambient_room';
    case 'autopilot':
      return 'room_signal > explicit_linkage > same_speaker_recent > ambient_room';
    case 'mention':
    case 'wakeword':
    default:
      return 'current_user_input > same_speaker_recent > explicit_named_subject > ambient_room';
  }
}

export function selectFocusedContinuityMessages(
  params: SelectFocusedContinuityMessagesParams,
): ChannelMessage[] {
  const {
    messages,
    currentTurn,
    replyTarget,
    excludedMessageIds,
    maxSameSpeakerMessages = 4,
    maxReplyNeighborMessages = 4,
  } = params;

  if (messages.length === 0) {
    return [];
  }

  const excluded = new Set<string>(excludedMessageIds ?? []);
  excluded.add(currentTurn.messageId);

  const pickedIds = new Set<string>();
  const pickedMessages: ChannelMessage[] = [];

  const addMessage = (message: ChannelMessage | undefined): void => {
    if (!message) {
      return;
    }
    if (shouldSkipMessage(message)) {
      return;
    }
    if (excluded.has(message.messageId) || pickedIds.has(message.messageId)) {
      return;
    }
    pickedIds.add(message.messageId);
    pickedMessages.push(message);
  };

  let sameSpeakerCount = 0;
  for (let index = messages.length - 1; index >= 0 && sameSpeakerCount < maxSameSpeakerMessages; index -= 1) {
    const message = messages[index];
    if (message.authorId !== currentTurn.invokerUserId || message.authorIsBot) {
      continue;
    }
    addMessage(message);
    if (pickedIds.has(message.messageId)) {
      sameSpeakerCount += 1;
    }
  }

  const canonicalReplyTargetId = replyTarget?.messageId ?? currentTurn.replyTargetMessageId ?? null;
  const canonicalReplyParentId = replyTarget?.replyToMessageId ?? null;

  if (canonicalReplyParentId) {
    const parentMessage = messages.find((message) => message.messageId === canonicalReplyParentId);
    addMessage(parentMessage);
  }

  let replyNeighborCount = 0;
  if (canonicalReplyTargetId) {
    for (
      let index = messages.length - 1;
      index >= 0 && replyNeighborCount < maxReplyNeighborMessages;
      index -= 1
    ) {
      const message = messages[index];
      const isDirectReplyNeighbor =
        message.messageId === canonicalReplyTargetId ||
        message.replyToMessageId === canonicalReplyTargetId;
      if (!isDirectReplyNeighbor) {
        continue;
      }
      const pickedBefore = pickedIds.has(message.messageId);
      addMessage(message);
      if (!pickedBefore && pickedIds.has(message.messageId)) {
        replyNeighborCount += 1;
      }
    }
  }

  const orderByMessageId = new Map(messages.map((message, index) => [message.messageId, index]));
  return pickedMessages.sort((left, right) => {
    return (orderByMessageId.get(left.messageId) ?? 0) - (orderByMessageId.get(right.messageId) ?? 0);
  });
}
