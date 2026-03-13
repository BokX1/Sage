import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { ToolCall } from '@langchain/core/messages/tool';
import type { LLMChatMessage, LLMMessageContent, LLMToolCall } from './llm-types';

function normalizeMessageContent(content: LLMMessageContent): BaseMessage['content'] {
  if (typeof content === 'string') {
    return content;
  }
  return content.map((part) => {
    if (part.type === 'text') {
      return { type: 'text', text: part.text };
    }
    return {
      type: 'image_url',
      image_url: {
        url: part.image_url.url,
      },
    };
  });
}

function normalizeStructuredContent(content: BaseMessage['content']): LLMMessageContent {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  const parts: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = [];

  for (const part of content) {
    if (typeof part === 'string') {
      parts.push({ type: 'text', text: part });
      continue;
    }

    if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
      parts.push({ type: 'text', text: part.text });
      continue;
    }

    if (
      part &&
      typeof part === 'object' &&
      'type' in part &&
      part.type === 'image_url' &&
      'image_url' in part &&
      part.image_url &&
      typeof part.image_url === 'object' &&
      'url' in part.image_url &&
      typeof part.image_url.url === 'string'
    ) {
      parts.push({
        type: 'image_url',
        image_url: { url: part.image_url.url },
      });
    }
  }

  return parts;
}

function coerceToolCalls(value: unknown): LLMToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name) {
      return [];
    }

    return [
      {
        id: typeof record.id === 'string' && record.id.trim().length > 0 ? record.id.trim() : undefined,
        name,
        args:
          record.args && typeof record.args === 'object' && !Array.isArray(record.args)
            ? record.args
            : {},
      },
    ];
  });
}

export function toLangChainToolCalls(toolCalls: LLMToolCall[] | undefined): ToolCall[] | undefined {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return undefined;
  }

  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    args:
      toolCall.args && typeof toolCall.args === 'object' && !Array.isArray(toolCall.args)
        ? toolCall.args as Record<string, unknown>
        : {},
    type: 'tool_call',
  }));
}

export function toLangChainMessages(messages: LLMChatMessage[]): BaseMessage[] {
  return messages.map((message) => {
    const content = normalizeMessageContent(message.content);
    switch (message.role) {
      case 'system':
        return new SystemMessage({ content });
      case 'assistant':
        return new AIMessage({
          content,
          tool_calls: toLangChainToolCalls(message.toolCalls),
        });
      case 'tool':
        return new ToolMessage({
          content: extractContentText(message.content),
          tool_call_id: message.toolCallId ?? 'tool-call',
        });
      case 'user':
      default:
        return new HumanMessage({ content });
    }
  });
}

export function toLlmMessages(messages: BaseMessage[]): LLMChatMessage[] {
  const normalized: LLMChatMessage[] = [];

  for (const message of messages) {
    if (ToolMessage.isInstance(message)) {
      normalized.push({
        role: 'tool',
        content: extractMessageText(message),
        toolCallId: message.tool_call_id,
      });
      continue;
    }

    const content = normalizeStructuredContent(message.content);

    if (SystemMessage.isInstance(message)) {
      normalized.push({ role: 'system', content });
      continue;
    }

    if (AIMessage.isInstance(message)) {
      normalized.push({
        role: 'assistant',
        content,
        toolCalls: coerceToolCalls(message.tool_calls),
      });
      continue;
    }

    normalized.push({ role: 'user', content });
  }

  return normalized;
}

export function extractContentText(content: LLMMessageContent): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .filter((value) => value.length > 0)
    .join('\n');
}

export function extractMessageText(message: BaseMessage | undefined): string {
  if (!message) {
    return '';
  }

  return extractContentText(normalizeStructuredContent(message.content));
}

export function getLastAiToolCalls(messages: BaseMessage[]): LLMToolCall[] {
  const lastMessage = messages.at(-1);
  if (!AIMessage.isInstance(lastMessage)) {
    return [];
  }
  return coerceToolCalls(lastMessage.tool_calls);
}
