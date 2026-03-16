const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const STRICT_PROBE_VERDICT = 'strict_json_schema_ok';

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

type CompatibleChatResponsePayload = {
  choices?: Array<{
    message?: {
      content?: string;
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
  return trimmed.slice(0, 200);
}

function readAssistantText(payload: CompatibleChatResponsePayload): string {
  return payload.choices?.[0]?.message?.content?.trim() ?? '';
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

export async function probeAiProviderStrictStructuredOutputs(
  params: AiProviderProbeParams,
): Promise<AiProviderProbeResult> {
  try {
    const response = await sendProbeRequest(params, {
      model: params.model,
      messages: [
        {
          role: 'system',
          content: 'Return only JSON that exactly matches the provided schema.',
        },
        {
          role: 'user',
          content: `Return {"verdict":"${STRICT_PROBE_VERDICT}"}.`,
        },
      ],
      max_tokens: 32,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'sage_strict_structured_output_probe',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              verdict: {
                type: 'string',
                enum: [STRICT_PROBE_VERDICT],
              },
            },
            required: ['verdict'],
          },
        },
      },
    });

    if (!response.ok) {
      const bodySnippet = getResponseBodySnippet(await response.text());
      return {
        ok: false,
        httpStatus: response.status,
        message: `AI provider strict structured-output probe failed (${response.status})`,
        details: [bodySnippet],
      };
    }

    const payload = (await response.json()) as CompatibleChatResponsePayload;
    const content = readAssistantText(payload);
    if (!content) {
      return {
        ok: false,
        message: 'AI provider strict structured-output probe returned an empty assistant message',
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      return {
        ok: false,
        message: 'AI provider strict structured-output probe returned non-JSON content',
        details: [String(error), getResponseBodySnippet(content)],
      };
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      (parsed as { verdict?: unknown }).verdict !== STRICT_PROBE_VERDICT
    ) {
      return {
        ok: false,
        message: 'AI provider strict structured-output probe returned the wrong JSON payload',
        details: [getResponseBodySnippet(JSON.stringify(parsed))],
      };
    }

    return {
      ok: true,
      message: 'AI provider strict structured-output probe succeeded',
    };
  } catch (error) {
    return {
      ok: false,
      message: 'AI provider strict structured-output probe request failed',
      details: [String(error)],
    };
  }
}

