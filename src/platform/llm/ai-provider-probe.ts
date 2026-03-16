const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const TOOL_NAME = 'sage_probe_echo';
const TOOL_ARG_VALUE = 'tool_call_roundtrip_ok';
const TOOL_RESULT_VALUE = 'tool_result_roundtrip_ok';
const FINAL_TEXT = 'Tool roundtrip complete.';

export type AiProviderProbeParams = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type AiProviderProbeResult = {
  ok: boolean;
  message: string;
  details?: string[];
  httpStatus?: number;
};

type CompatibleChatToolCall = {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type CompatibleChatResponsePayload = {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: CompatibleChatToolCall[];
    };
  }>;
};

function normalizeAiProviderBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, '').replace(/\/chat\/completions$/, '');
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (apiKey?.trim()) {
    headers.authorization = `Bearer ${apiKey.trim()}`;
  }
  return headers;
}

function getFetchImpl(fetchImpl?: typeof fetch): typeof fetch {
  if (fetchImpl) {
    return fetchImpl;
  }
  return fetch;
}

function getTimeoutMs(timeoutMs?: number): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
    return DEFAULT_PROBE_TIMEOUT_MS;
  }
  return Math.max(1_000, Math.floor(timeoutMs));
}

function getResponseBodySnippet(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return '[empty response body]';
  }
  return trimmed.slice(0, 300);
}

function readAssistantText(payload: CompatibleChatResponsePayload): string {
  return payload.choices?.[0]?.message?.content?.trim() ?? '';
}

function readAssistantToolCalls(payload: CompatibleChatResponsePayload): CompatibleChatToolCall[] {
  return payload.choices?.[0]?.message?.tool_calls ?? [];
}

async function sendProbeRequest(
  params: AiProviderProbeParams,
  body: Record<string, unknown>,
): Promise<Response> {
  const fetchImpl = getFetchImpl(params.fetchImpl);
  const endpoint = `${normalizeAiProviderBaseUrl(params.baseUrl)}/chat/completions`;
  return fetchImpl(endpoint, {
    method: 'POST',
    headers: buildHeaders(params.apiKey),
    signal: AbortSignal.timeout(getTimeoutMs(params.timeoutMs)),
    body: JSON.stringify(body),
  });
}

export async function probeAiProviderPing(
  params: AiProviderProbeParams,
): Promise<AiProviderProbeResult> {
  try {
    const response = await sendProbeRequest(params, {
      model: params.model,
      messages: [{ role: 'user', content: 'Respond with exactly: OK' }],
      max_tokens: 8,
      temperature: 0,
    });

    if (!response.ok) {
      const bodySnippet = getResponseBodySnippet(await response.text());
      return {
        ok: false,
        httpStatus: response.status,
        message: `AI provider ping failed (${response.status})`,
        details: [bodySnippet],
      };
    }

    const payload = (await response.json()) as CompatibleChatResponsePayload;
    const content = readAssistantText(payload);
    return {
      ok: true,
      message: content ? `AI provider ping succeeded (${content})` : 'AI provider ping succeeded',
    };
  } catch (error) {
    return {
      ok: false,
      message: 'AI provider ping request failed',
      details: [String(error)],
    };
  }
}

function buildProbeToolDefinition(): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: TOOL_NAME,
      description: 'Echoes the probe value so Sage can validate Chat Completions tool calling.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          value: {
            type: 'string',
            enum: [TOOL_ARG_VALUE],
          },
        },
        required: ['value'],
      },
    },
  };
}

function parseToolArgs(rawArgs: string | undefined): Record<string, unknown> | null {
  if (!rawArgs?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawArgs);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function probeAiProviderToolCalling(
  params: AiProviderProbeParams,
): Promise<AiProviderProbeResult> {
  try {
    const firstResponse = await sendProbeRequest(params, {
      model: params.model,
      temperature: 0,
      max_tokens: 128,
      tools: [buildProbeToolDefinition()],
      tool_choice: 'auto',
      messages: [
        {
          role: 'system',
          content:
            `You must use the ${TOOL_NAME} tool exactly once with {"value":"${TOOL_ARG_VALUE}"}. ` +
            'Do not answer normally before calling the tool.',
        },
        {
          role: 'user',
          content: `Call ${TOOL_NAME} now.`,
        },
      ],
    });

    if (!firstResponse.ok) {
      const bodySnippet = getResponseBodySnippet(await firstResponse.text());
      return {
        ok: false,
        httpStatus: firstResponse.status,
        message: `AI provider tool-calling probe failed (${firstResponse.status})`,
        details: [bodySnippet],
      };
    }

    const firstPayload = (await firstResponse.json()) as CompatibleChatResponsePayload;
    const toolCalls = readAssistantToolCalls(firstPayload);
    if (toolCalls.length !== 1) {
      return {
        ok: false,
        message: 'AI provider tool-calling probe did not return exactly one assistant tool call',
        details: [getResponseBodySnippet(JSON.stringify(firstPayload))],
      };
    }

    const toolCall = toolCalls[0]!;
    if (toolCall.function?.name !== TOOL_NAME) {
      return {
        ok: false,
        message: 'AI provider tool-calling probe returned the wrong tool name',
        details: [getResponseBodySnippet(JSON.stringify(toolCall))],
      };
    }

    const parsedArgs = parseToolArgs(toolCall.function.arguments);
    if (!parsedArgs || parsedArgs.value !== TOOL_ARG_VALUE) {
      return {
        ok: false,
        message: 'AI provider tool-calling probe returned malformed tool-call arguments',
        details: [getResponseBodySnippet(toolCall.function?.arguments ?? '')],
      };
    }

    const secondResponse = await sendProbeRequest(params, {
      model: params.model,
      temperature: 0,
      max_tokens: 64,
      tools: [buildProbeToolDefinition()],
      tool_choice: 'auto',
      messages: [
        {
          role: 'system',
          content: `When the tool result says "${TOOL_RESULT_VALUE}", reply with exactly "${FINAL_TEXT}" and no tool calls.`,
        },
        {
          role: 'user',
          content: `Call ${TOOL_NAME} now.`,
        },
        {
          role: 'assistant',
          content: firstPayload.choices?.[0]?.message?.content ?? '',
          tool_calls: toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: {
              name: call.function?.name,
              arguments: call.function?.arguments,
            },
          })),
        },
        {
          role: 'tool',
          tool_call_id: toolCall.id ?? 'probe-call-1',
          content: JSON.stringify({ value: TOOL_RESULT_VALUE }),
        },
      ],
    });

    if (!secondResponse.ok) {
      const bodySnippet = getResponseBodySnippet(await secondResponse.text());
      return {
        ok: false,
        httpStatus: secondResponse.status,
        message: `AI provider tool-result roundtrip probe failed (${secondResponse.status})`,
        details: [bodySnippet],
      };
    }

    const secondPayload = (await secondResponse.json()) as CompatibleChatResponsePayload;
    const secondToolCalls = readAssistantToolCalls(secondPayload);
    if (secondToolCalls.length > 0) {
      return {
        ok: false,
        message: 'AI provider tool-calling probe returned follow-up tool calls instead of a final assistant reply',
        details: [getResponseBodySnippet(JSON.stringify(secondPayload))],
      };
    }

    const content = readAssistantText(secondPayload);
    if (content !== FINAL_TEXT) {
      return {
        ok: false,
        message: 'AI provider tool-calling probe returned the wrong final assistant reply',
        details: [getResponseBodySnippet(content)],
      };
    }

    return {
      ok: true,
      message: 'AI provider Chat Completions tool-calling probe succeeded',
    };
  } catch (error) {
    return {
      ok: false,
      message: 'AI provider tool-calling probe request failed',
      details: [String(error)],
    };
  }
}
