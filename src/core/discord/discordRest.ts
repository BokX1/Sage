import { config } from '../../config';
import { isPrivateOrLocalHostname } from '../../shared/config/env';
import { logger } from '../utils/logger';

export type DiscordRestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type DiscordRestMultipartBodyMode = 'payload_json' | 'fields';

export type DiscordRestFileSource =
  | { type: 'url'; url: string }
  | { type: 'text'; text: string }
  | { type: 'base64'; base64: string };

export type DiscordRestFileInput = {
  fieldName?: string;
  filename: string;
  contentType?: string;
  source: DiscordRestFileSource;
};

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const MAX_DEFAULT_RESPONSE_CHARS = 12_000;
const MAX_DEFAULT_UPLOAD_FILES = 10;
const MAX_DEFAULT_UPLOAD_BYTES_PER_FILE = 25_000_000;
const MAX_DEFAULT_UPLOAD_TOTAL_BYTES = 50_000_000;

function isDiscordRestMethod(value: string): value is DiscordRestMethod {
  switch (value.toUpperCase()) {
    case 'GET':
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
      return true;
    default:
      return false;
  }
}

function normalizeApiPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Discord REST path must not be empty.');
  }
  if (/^https?:\/\//i.test(trimmed)) {
    throw new Error('Discord REST path must be a relative API path (starting with "/"), not a full URL.');
  }
  if (!trimmed.startsWith('/')) {
    throw new Error('Discord REST path must start with "/".');
  }
  return trimmed;
}

function sanitizeFilename(value: string): string {
  const trimmed = value.trim();
  const stripped = trimmed.replace(/[\\/]/g, '_').replace(/\0/g, '');
  if (!stripped) {
    return 'file';
  }
  return stripped.slice(0, 255);
}

function sanitizePublicHttpUrl(value: string): string {
  const raw = value.trim();
  if (!raw) {
    throw new Error('File URL must not be empty.');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('File URL must be a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('File URL must start with http:// or https://');
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    throw new Error('File URL must be a public address (private/local hosts are blocked).');
  }
  parsed.hash = '';
  return parsed.toString();
}

function formatUrlForLogs(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function normalizeQuery(
  query: Record<string, string | number | boolean | null | undefined> | undefined,
): Record<string, string> | undefined {
  if (!query) return undefined;
  const entries = Object.entries(query)
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key]) => key.length > 0)
    .flatMap(([key, value]) => {
      if (value === null || value === undefined) return [];
      if (typeof value === 'string') return [[key, value]];
      if (typeof value === 'number' && Number.isFinite(value)) return [[key, String(value)]];
      if (typeof value === 'boolean') return [[key, value ? 'true' : 'false']];
      return [[key, String(value)]];
    });

  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function buildDiscordApiUrl(params: {
  path: string;
  query?: Record<string, string>;
}): string {
  const url = new URL(`${DISCORD_API_BASE_URL}${params.path}`);
  if (params.query) {
    for (const [key, value] of Object.entries(params.query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function urlEncodeAuditReason(reason: string): string {
  // Discord requires URL-encoded audit log reason.
  return encodeURIComponent(reason).slice(0, 1_000);
}

function resolveUploadLimits(): { maxFiles: number; maxBytesPerFile: number; maxTotalBytes: number } {
  const maxFiles = Math.max(
    1,
    Math.min(config.FILE_INGEST_MAX_ATTACHMENTS_PER_MESSAGE, MAX_DEFAULT_UPLOAD_FILES),
  );
  const maxBytesPerFile = Math.max(
    1024,
    Math.min(config.FILE_INGEST_MAX_BYTES_PER_FILE, MAX_DEFAULT_UPLOAD_BYTES_PER_FILE),
  );
  const maxTotalBytes = Math.max(
    maxBytesPerFile,
    Math.min(config.FILE_INGEST_MAX_TOTAL_BYTES_PER_MESSAGE, MAX_DEFAULT_UPLOAD_TOTAL_BYTES),
  );

  return { maxFiles, maxBytesPerFile, maxTotalBytes };
}

async function safeReadResponseBody(response: Response): Promise<{ parsed: unknown; rawText: string; isJson: boolean }> {
  const rawText = await response.text();
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const isJson = contentType.includes('application/json') || contentType.includes('+json');
  if (!isJson) {
    return { parsed: rawText, rawText, isJson: false };
  }
  try {
    const parsed = JSON.parse(rawText) as unknown;
    return { parsed, rawText, isJson: true };
  } catch {
    return { parsed: rawText, rawText, isJson: true };
  }
}

function trimToMaxChars(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: `${value.slice(0, Math.max(1, maxChars - 1))}…`, truncated: true };
}

async function readResponseBytesWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new Error(`File exceeds maximum allowed size (${length} > ${maxBytes} bytes).`);
    }
  }

  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error(`File exceeds maximum allowed size (${buffer.byteLength} > ${maxBytes} bytes).`);
    }
    return new Uint8Array(buffer);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new Error(`File exceeds maximum allowed size (${total} > ${maxBytes} bytes).`);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function decodeBase64Payload(payload: string): Uint8Array {
  const trimmed = payload.trim();
  if (!trimmed) {
    throw new Error('base64 payload must not be empty.');
  }

  const match = trimmed.match(/^data:([^;]+);base64,(.+)$/i);
  const raw = match ? match[2] : trimmed;
  const buffer = Buffer.from(raw, 'base64');
  if (buffer.length === 0) {
    throw new Error('base64 payload decoded to empty bytes.');
  }
  return buffer;
}

async function resolveMultipartFileBytes(params: {
  file: DiscordRestFileInput;
  maxBytes: number;
  signal?: AbortSignal;
}): Promise<{ bytes: Uint8Array; contentType?: string; sourceLabel: string }> {
  switch (params.file.source.type) {
    case 'text': {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(params.file.source.text);
      if (bytes.byteLength > params.maxBytes) {
        throw new Error(`File exceeds maximum allowed size (${bytes.byteLength} > ${params.maxBytes} bytes).`);
      }
      return {
        bytes,
        contentType: 'text/plain; charset=utf-8',
        sourceLabel: 'text',
      };
    }
    case 'base64': {
      const bytes = decodeBase64Payload(params.file.source.base64);
      if (bytes.byteLength > params.maxBytes) {
        throw new Error(`File exceeds maximum allowed size (${bytes.byteLength} > ${params.maxBytes} bytes).`);
      }
      return {
        bytes,
        sourceLabel: 'base64',
      };
    }
    case 'url': {
      const url = sanitizePublicHttpUrl(params.file.source.url);
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': 'Sage (https://github.com/BokX1/Sage)' },
        signal: params.signal,
      });
      if (!response.ok) {
        throw new Error(`File download failed (${response.status} ${response.statusText}).`);
      }
      const bytes = await readResponseBytesWithLimit(response, params.maxBytes);
      const contentType = response.headers.get('content-type')?.trim() || undefined;
      return { bytes, contentType, sourceLabel: formatUrlForLogs(url) };
    }
    default: {
      const exhaustive: never = params.file.source;
      return exhaustive;
    }
  }
}

async function buildMultipartBody(params: {
  body: unknown;
  files: DiscordRestFileInput[];
  multipartBodyMode: DiscordRestMultipartBodyMode;
  signal?: AbortSignal;
}): Promise<FormData> {
  const limits = resolveUploadLimits();
  if (params.files.length > limits.maxFiles) {
    throw new Error(`Too many files (${params.files.length}); max allowed is ${limits.maxFiles}.`);
  }

  const form = new FormData();
  const mode = params.multipartBodyMode ?? 'payload_json';

  if (mode === 'fields') {
    if (params.body !== undefined) {
      if (typeof params.body !== 'object' || params.body === null || Array.isArray(params.body)) {
        throw new Error('multipartBodyMode="fields" requires body to be an object.');
      }

      for (const [key, value] of Object.entries(params.body as Record<string, unknown>)) {
        const field = key.trim();
        if (!field) continue;
        if (value === undefined || value === null) continue;
        if (typeof value === 'string') {
          form.append(field, value);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          form.append(field, String(value));
        } else {
          form.append(field, JSON.stringify(value));
        }
      }
    }
  } else {
    const payload = params.body === undefined ? {} : params.body;
    form.append('payload_json', JSON.stringify(payload));
  }

  let totalBytes = 0;
  for (let index = 0; index < params.files.length; index += 1) {
    const file = params.files[index];
    const { bytes, contentType: detectedType, sourceLabel } = await resolveMultipartFileBytes({
      file,
      maxBytes: limits.maxBytesPerFile,
      signal: params.signal,
    });
    totalBytes += bytes.byteLength;
    if (totalBytes > limits.maxTotalBytes) {
      throw new Error(`Total file upload size exceeds limit (${totalBytes} > ${limits.maxTotalBytes} bytes).`);
    }

    const fieldName = file.fieldName?.trim() || `files[${index}]`;
    const filename = sanitizeFilename(file.filename);
    const contentType = file.contentType?.trim() || detectedType || 'application/octet-stream';
    const safeBytes = new Uint8Array(bytes.byteLength);
    safeBytes.set(bytes);
    const blob = new Blob([safeBytes], { type: contentType });
    form.append(fieldName, blob, filename);
    logger.info(
      { index, fieldName, filename, bytes: bytes.byteLength, source: sourceLabel },
      'discord_rest: multipart file attached',
    );
  }

  return form;
}

export async function discordRestRequest(params: {
  method: DiscordRestMethod | string;
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  files?: DiscordRestFileInput[];
  multipartBodyMode?: DiscordRestMultipartBodyMode;
  reason?: string;
  maxResponseChars?: number;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  if (!config.DISCORD_TOKEN?.trim()) {
    throw new Error('DISCORD_TOKEN is required for Discord REST requests.');
  }

  const method = params.method.toUpperCase();
  if (!isDiscordRestMethod(method)) {
    throw new Error(`Unsupported Discord REST method: ${params.method}`);
  }

  const path = normalizeApiPath(params.path);
  const query = normalizeQuery(params.query);
  const url = buildDiscordApiUrl({ path, query });
  const maxResponseChars = Math.max(
    500,
    Math.min(params.maxResponseChars ?? MAX_DEFAULT_RESPONSE_CHARS, 50_000),
  );

  const headers: Record<string, string> = {
    Authorization: `Bot ${config.DISCORD_TOKEN.trim()}`,
    'User-Agent': 'Sage (https://github.com/BokX1/Sage)',
  };

  const reason = params.reason?.trim();
  if (reason) {
    headers['X-Audit-Log-Reason'] = urlEncodeAuditReason(reason);
  }

  let body: string | FormData | undefined;
  const files = params.files?.length ? params.files : [];
  const hasFiles = files.length > 0;

  if (hasFiles) {
    if (method === 'GET') {
      throw new Error('Discord REST multipart requests do not support GET.');
    }
    body = await buildMultipartBody({
      body: params.body,
      files,
      multipartBodyMode: params.multipartBodyMode ?? 'payload_json',
      signal: params.signal,
    });
  } else if (method !== 'GET' && method !== 'DELETE' && params.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(params.body);
  }

  logger.info({ method, path, hasFiles, fileCount: files.length }, 'discord_rest: request');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: params.signal,
    });

    const rateLimit = {
      limit: response.headers.get('x-ratelimit-limit'),
      remaining: response.headers.get('x-ratelimit-remaining'),
      resetAfter: response.headers.get('x-ratelimit-reset-after'),
      retryAfter: response.headers.get('retry-after'),
      bucket: response.headers.get('x-ratelimit-bucket'),
      scope: response.headers.get('x-ratelimit-scope'),
    };

    const { parsed, rawText, isJson } = await safeReadResponseBody(response);
    const trimmed = trimToMaxChars(rawText, maxResponseChars);

    if (response.ok) {
      return {
        ok: true,
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        rateLimit,
        isJson,
        data: parsed,
        rawText: trimmed.text,
        truncated: trimmed.truncated,
      };
    }

    if (response.status === 429 && attempt === 0) {
      const retryAfterHeader = response.headers.get('retry-after')?.trim() ?? '';
      const retryAfterFromHeader = retryAfterHeader ? Number.parseFloat(retryAfterHeader) : Number.NaN;
      const retryAfterFromJson =
        isJson &&
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).retry_after === 'number'
          ? (parsed as Record<string, unknown>).retry_after
          : Number.NaN;

      const retryAfterSeconds = Number.isFinite(retryAfterFromJson)
        ? (retryAfterFromJson as number)
        : retryAfterFromHeader;
      const waitMs = Math.max(0, Math.min(5_000, Math.ceil((retryAfterSeconds || 0) * 1000)));

      logger.warn(
        {
          method,
          path,
          waitMs,
          rateLimit,
          attempt,
        },
        'discord_rest: rate limited, retrying once',
      );

      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      continue;
    }

    const hint = response.status === 429
      ? 'Discord rate limited the request. Retry after the indicated delay.'
      : undefined;

    return {
      ok: false,
      method,
      url,
      status: response.status,
      statusText: response.statusText,
      rateLimit,
      isJson,
      error: trimmed.text,
      truncated: trimmed.truncated,
      guidance: hint,
    };
  }

  // Unreachable in practice; the loop either returns or continues on the first 429 retry.
  return {
    ok: false,
    method,
    url,
    status: 429,
    statusText: 'Too Many Requests',
    rateLimit: {},
    isJson: false,
    error: 'Discord rate limited the request.',
    truncated: false,
    guidance: 'Discord rate limited the request. Retry after the indicated delay.',
  };
}
