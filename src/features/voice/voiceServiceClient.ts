import { config } from '../../platform/config/env';
import { logger } from '../../platform/logging/logger';
import { normalizeBoundedInt } from '../../shared/utils/numbers';

type TranscribeResult = {
  text: string;
  language: string | null;
  segments?: Array<{ startMs: number; endMs: number; text: string }>;
  durationMs?: number;
};

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  id.unref?.();
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function voiceServiceHealth(): Promise<{ ok: boolean; details?: unknown }> {
  const baseUrl = normalizeBaseUrl(config.VOICE_SERVICE_BASE_URL);
  const url = `${baseUrl}/health`;
  try {
    const res = await fetchWithTimeout(url, { method: 'GET' }, 2_000);
    if (!res.ok) {
      return { ok: false, details: { status: res.status, statusText: res.statusText } };
    }
    const json = await res.json().catch(() => null);
    return { ok: true, details: json };
  } catch (error) {
    return { ok: false, details: { error: error instanceof Error ? error.message : String(error) } };
  }
}

export async function transcribeWav(params: {
  wavBytes: Buffer;
  language?: string;
  prompt?: string;
}): Promise<TranscribeResult> {
  const baseUrl = normalizeBaseUrl(config.VOICE_SERVICE_BASE_URL);
  const url = `${baseUrl}/v1/stt/transcribe`;
  const timeoutMs = normalizeBoundedInt(
    config.TIMEOUT_CHAT_MS as number | undefined,
    45_000,
    1_000,
    180_000,
  );

  const form = new FormData();
  // TS lib.dom's BlobPart typing doesn't accept Node's Buffer<ArrayBufferLike> cleanly.
  // Build a Uint8Array view over the underlying ArrayBuffer to avoid copies.
  const ab = params.wavBytes.buffer as ArrayBuffer;
  const view = new Uint8Array(ab, params.wavBytes.byteOffset, params.wavBytes.byteLength);
  const blob = new Blob([view], { type: 'audio/wav' });
  form.append('audio', blob, 'audio.wav');
  if (params.language) form.append('language', params.language);
  if (params.prompt) form.append('prompt', params.prompt);

  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      body: form,
    },
    timeoutMs,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`voice-service STT failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as Partial<TranscribeResult>;
  return {
    text: (json.text ?? '').trim(),
    language: (json.language ?? null) as string | null,
    segments: Array.isArray(json.segments) ? json.segments : undefined,
    durationMs: typeof json.durationMs === 'number' ? json.durationMs : undefined,
  };
}

export function logVoiceServiceConfig(): void {
  logger.debug(
    {
      baseUrl: config.VOICE_SERVICE_BASE_URL,
      sttEnabled: config.VOICE_STT_ENABLED,
      sttModelId: config.VOICE_STT_MODEL_ID,
    },
    'Voice service config',
  );
}
