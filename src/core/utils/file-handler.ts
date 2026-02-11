export type AttachmentExtractor = 'native' | 'tika' | 'none';

export type FetchAttachmentTextOptions = {
  timeoutMs: number;
  maxBytes: number;
  maxChars?: number;
  truncateStrategy?: 'head' | 'head_tail';
  headChars?: number;
  tailChars?: number;
  contentType?: string | null;
  declaredSizeBytes?: number | null;
  tikaBaseUrl?: string;
  ocrEnabled?: boolean;
};

type ResultMeta = {
  extractor: AttachmentExtractor;
  mimeType?: string | null;
  byteLength?: number;
};

export type FetchAttachmentResult =
  | ({ kind: 'skip'; reason: string } & ResultMeta)
  | ({ kind: 'too_large'; message: string } & ResultMeta)
  | ({ kind: 'truncated'; text: string; message: string } & ResultMeta)
  | ({ kind: 'error'; message: string } & ResultMeta)
  | ({ kind: 'ok'; text: string } & ResultMeta);

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_FILENAME_LENGTH = 200;
const DEFAULT_TIKA_BASE_URL = 'http://127.0.0.1:9998';

const TEXT_LIKE_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'php',
  'cs',
  'cpp',
  'c',
  'h',
  'hpp',
  'scala',
  'lua',
  'json',
  'jsonl',
  'json5',
  'ndjson',
  'xml',
  'html',
  'css',
  'scss',
  'less',
  'csv',
  'tsv',
  'log',
  'env',
  'yml',
  'yaml',
  'sh',
  'bash',
  'zsh',
  'sql',
  'toml',
  'ini',
  'graphql',
  'gql',
  'prisma',
  'conf',
  'cfg',
  'dockerfile',
  'gitignore',
  'makefile',
]);

const TEXT_MIME_HINTS = [
  'text/',
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/toml',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
  'application/x-sh',
  'application/sql',
  'application/graphql',
  'application/x-www-form-urlencoded',
];

const ALLOWED_ATTACHMENT_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
  );
}

function isAllowedAttachmentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (isPrivateOrLocalHostname(parsed.hostname)) return false;
    return ALLOWED_ATTACHMENT_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function buildSystemMessage(message: string): string {
  return `[System: ${message}]`;
}

function normalizeFilename(filename: string): string {
  return filename.split('?')[0]?.split('#')[0] ?? filename;
}

function sanitizeFilenameForHeader(filename: string): string {
  const normalized = normalizeFilename(filename).split('/').pop() ?? filename;
  const safe = normalized.replace(/[^A-Za-z0-9._ -]/g, '_').trim();
  return safe.length > 0 ? safe.slice(0, 120) : 'attachment.bin';
}

function getExtension(filename: string): string | null {
  const sanitized = normalizeFilename(filename);
  const lastSegment = sanitized.split('/').pop() ?? sanitized;
  const parts = lastSegment.split('.');
  if (parts.length < 2) {
    const lower = lastSegment.toLowerCase();
    if (lower === 'dockerfile' || lower === 'makefile' || lower === '.gitignore') {
      return lower.replace(/^\./, '');
    }
    return null;
  }
  return parts.pop()?.toLowerCase() ?? null;
}

function isFilenameSuspicious(filename?: string | null): boolean {
  if (!filename) return true;
  const trimmed = filename.trim();
  if (trimmed.length === 0) return true;
  return trimmed.length > MAX_FILENAME_LENGTH;
}

function formatLimitNotice(maxBytes: number, maxChars?: number): string {
  const bytesPart = `${maxBytes.toLocaleString()} bytes`;
  if (!maxChars) {
    return bytesPart;
  }
  return `${maxChars.toLocaleString()} chars / ${bytesPart}`;
}

function resolveMaxBytes(options: Partial<FetchAttachmentTextOptions>): number {
  if (typeof options.maxBytes === 'number' && Number.isFinite(options.maxBytes)) {
    return options.maxBytes;
  }
  if (typeof options.maxChars === 'number' && Number.isFinite(options.maxChars)) {
    return Math.floor(options.maxChars * 4);
  }
  return 0;
}

function resolveMaxChars(
  options: Partial<FetchAttachmentTextOptions>,
  fallback: number,
): number | undefined {
  if (typeof options.maxChars === 'number' && Number.isFinite(options.maxChars)) {
    return options.maxChars;
  }
  if (Number.isFinite(fallback) && fallback > 0) {
    return fallback;
  }
  return undefined;
}

function truncateText(
  text: string,
  maxChars: number,
  strategy: 'head' | 'head_tail',
  headChars?: number,
  tailChars?: number,
): string {
  if (maxChars <= 0) {
    return '';
  }

  if (strategy === 'head') {
    return text.slice(0, maxChars).trimEnd();
  }

  const separator = '\n...\n';
  const available = Math.max(0, maxChars - separator.length);
  if (available === 0) {
    return text.slice(0, maxChars).trimEnd();
  }

  const resolvedHead = Math.max(
    0,
    Math.min(headChars ?? Math.floor(available * 0.7), available),
  );
  const resolvedTail = Math.max(
    0,
    Math.min(tailChars ?? available - resolvedHead, available - resolvedHead),
  );

  const headText = text.slice(0, resolvedHead).trimEnd();
  const tailText = resolvedTail > 0 ? text.slice(text.length - resolvedTail).trimStart() : '';
  if (!tailText) {
    return headText;
  }
  return `${headText}${separator}${tailText}`;
}

function normalizeMimeType(value?: string | null): string | null {
  if (!value) return null;
  const [mimeType] = value.split(';');
  const normalized = mimeType?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function isLikelyTextMimeType(mimeType?: string | null): boolean {
  const normalized = normalizeMimeType(mimeType);
  if (!normalized) return false;
  return TEXT_MIME_HINTS.some((hint) => normalized.startsWith(hint));
}

function isLikelyTextAttachment(filename: string, mimeType?: string | null): boolean {
  const extension = getExtension(filename);
  if (extension && TEXT_LIKE_EXTENSIONS.has(extension)) {
    return true;
  }
  return isLikelyTextMimeType(mimeType);
}

function stripNul(value: string): string {
  return value.replaceAll('\0', '');
}

function extractTextNative(buffer: Buffer): string {
  const decoder = new TextDecoder('utf-8');
  const decoded = decoder.decode(buffer);
  return stripNul(decoded);
}

function isProbablyBinaryText(text: string): boolean {
  if (text.length === 0) return false;
  const sample = text.slice(0, Math.min(4096, text.length));
  let controlCount = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    if (code === 0) {
      return true;
    }
    const isControl = code < 32 && code !== 9 && code !== 10 && code !== 13;
    if (isControl) {
      controlCount += 1;
    }
  }
  return controlCount / sample.length > 0.02;
}

type AttachmentBytesResult =
  | { kind: 'ok'; buffer: Buffer; contentType: string | null; byteLength: number }
  | { kind: 'skip'; reason: string }
  | { kind: 'too_large'; message: string }
  | { kind: 'error'; message: string };

async function readResponseBodyWithinLimit(
  response: Response,
  maxBytes: number,
): Promise<{ kind: 'ok'; buffer: Buffer } | { kind: 'too_large' }> {
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      return { kind: 'too_large' };
    }
    return { kind: 'ok', buffer };
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    const nodeChunk = Buffer.from(chunk);
    totalBytes += nodeChunk.byteLength;
    if (totalBytes > maxBytes) {
      return { kind: 'too_large' };
    }
    chunks.push(nodeChunk);
  }

  return { kind: 'ok', buffer: Buffer.concat(chunks, totalBytes) };
}

async function fetchAttachmentBytes(
  url: string,
  filename: string,
  opts: {
    timeoutMs: number;
    maxBytes: number;
    declaredSizeBytes?: number | null;
    contentType?: string | null;
  },
): Promise<AttachmentBytesResult> {
  const declaredSize = opts.declaredSizeBytes;
  if (typeof declaredSize === 'number' && Number.isFinite(declaredSize) && declaredSize > opts.maxBytes) {
    return {
      kind: 'too_large',
      message: buildSystemMessage(
        `File '${filename}' is too large to read (Limit: ${opts.maxBytes.toLocaleString()} bytes).`,
      ),
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return {
        kind: 'error',
        message: buildSystemMessage(
          `Failed to fetch file '${filename}' (HTTP ${response.status}).`,
        ),
      };
    }

    const contentType = normalizeMimeType(response.headers.get('content-type') ?? opts.contentType);
    if (contentType?.startsWith('image/')) {
      return {
        kind: 'skip',
        reason: buildSystemMessage(`Attachment '${filename}' is an image; skipped.`),
      };
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const length = Number(contentLength);
      if (Number.isFinite(length) && length > opts.maxBytes) {
        return {
          kind: 'too_large',
          message: buildSystemMessage(
            `File '${filename}' is too large to read (Limit: ${opts.maxBytes.toLocaleString()} bytes).`,
          ),
        };
      }
    }

    const bodyResult = await readResponseBodyWithinLimit(response, opts.maxBytes);
    if (bodyResult.kind === 'too_large') {
      return {
        kind: 'too_large',
        message: buildSystemMessage(
          `File '${filename}' is too large to read (Limit: ${opts.maxBytes.toLocaleString()} bytes).`,
        ),
      };
    }

    return {
      kind: 'ok',
      buffer: bodyResult.buffer,
      contentType,
      byteLength: bodyResult.buffer.byteLength,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      kind: 'error',
      message: buildSystemMessage(`Failed to read file '${filename}': ${message}.`),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

type TikaResult = { kind: 'ok'; text: string } | { kind: 'error'; message: string };

function resolveTikaEndpoint(baseUrl?: string): string | null {
  const rawBaseUrl = (baseUrl ?? DEFAULT_TIKA_BASE_URL).trim();
  if (!rawBaseUrl) {
    return null;
  }

  try {
    const parsed = new URL(rawBaseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const trimmed = parsed.toString().replace(/\/$/, '');
    return trimmed.endsWith('/tika') ? trimmed : `${trimmed}/tika`;
  } catch {
    return null;
  }
}

async function extractTextWithTika(
  buffer: Buffer,
  params: {
    filename: string;
    contentType?: string | null;
    timeoutMs: number;
    tikaBaseUrl?: string;
    ocrEnabled?: boolean;
  },
): Promise<TikaResult> {
  const endpoint = resolveTikaEndpoint(params.tikaBaseUrl);
  if (!endpoint) {
    return { kind: 'error', message: 'Tika endpoint is not configured.' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);
  const headers: Record<string, string> = {
    Accept: 'text/plain',
    'Content-Type': params.contentType ?? 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${sanitizeFilenameForHeader(params.filename)}"`,
  };
  if (!params.ocrEnabled) {
    headers['X-Tika-OCRskipOcr'] = 'true';
  }

  try {
    const request = async (method: 'PUT' | 'POST') =>
      fetch(endpoint, {
        method,
        headers,
        body: buffer,
        signal: controller.signal,
      });

    let response = await request('PUT');
    if (response.status === 405) {
      response = await request('POST');
    }

    if (!response.ok) {
      return {
        kind: 'error',
        message: `Tika extraction failed (HTTP ${response.status}).`,
      };
    }

    const text = stripNul(await response.text());
    return { kind: 'ok', text };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { kind: 'error', message: `Tika extraction failed: ${message}.` };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchAttachmentText(
  url: string,
  filename: string,
  opts: Partial<FetchAttachmentTextOptions> = {},
): Promise<FetchAttachmentResult> {
  if (!url) {
    return {
      kind: 'skip',
      reason: buildSystemMessage('Attachment URL missing; skipped.'),
      extractor: 'none',
    };
  }

  if (!isAllowedAttachmentUrl(url)) {
    return {
      kind: 'skip',
      reason: buildSystemMessage('Attachment URL is not from an allowed host; skipped.'),
      extractor: 'none',
    };
  }

  if (isFilenameSuspicious(filename)) {
    return {
      kind: 'skip',
      reason: buildSystemMessage('Attachment filename missing or suspicious; skipped.'),
      extractor: 'none',
    };
  }

  const maxBytes = resolveMaxBytes(opts);
  const maxChars = resolveMaxChars(opts, Math.floor(maxBytes / 2));
  if (maxBytes <= 0 || (typeof maxChars === 'number' && maxChars <= 0)) {
    return {
      kind: 'too_large',
      message: buildSystemMessage(`File '${filename}' omitted due to context limits.`),
      extractor: 'none',
    };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetched = await fetchAttachmentBytes(url, filename, {
    timeoutMs,
    maxBytes,
    declaredSizeBytes: opts.declaredSizeBytes,
    contentType: opts.contentType,
  });

  if (fetched.kind === 'skip') {
    return {
      kind: 'skip',
      reason: fetched.reason,
      extractor: 'none',
    };
  }

  if (fetched.kind === 'too_large') {
    return {
      kind: 'too_large',
      message: fetched.message,
      extractor: 'none',
    };
  }

  if (fetched.kind === 'error') {
    return {
      kind: 'error',
      message: fetched.message,
      extractor: 'none',
    };
  }

  const mimeType = fetched.contentType;
  const likelyText = isLikelyTextAttachment(filename, mimeType);
  let extractedText = '';
  let extractor: AttachmentExtractor = 'none';
  let tikaFailureMessage: string | null = null;

  const tikaResult = await extractTextWithTika(fetched.buffer, {
    filename,
    contentType: mimeType ?? opts.contentType,
    timeoutMs,
    tikaBaseUrl: opts.tikaBaseUrl,
    ocrEnabled: opts.ocrEnabled,
  });
  if (tikaResult.kind === 'ok') {
    extractedText = tikaResult.text;
    extractor = 'tika';
  } else {
    tikaFailureMessage = tikaResult.message;
  }

  if (!extractedText && likelyText) {
    const nativeText = extractTextNative(fetched.buffer);
    if (!isProbablyBinaryText(nativeText)) {
      extractedText = nativeText;
      extractor = 'native';
    }
  }

  const normalizedText = extractedText.replace(/\r\n/g, '\n').trimEnd();
  if (normalizedText.trim().length === 0) {
    if (tikaFailureMessage) {
      return {
        kind: 'skip',
        reason: buildSystemMessage(
          `Attachment '${filename}' could not be parsed by Tika and had no text fallback.`,
        ),
        extractor: 'none',
        mimeType,
        byteLength: fetched.byteLength,
      };
    }
    return {
      kind: 'skip',
      reason: buildSystemMessage(`Attachment '${filename}' has no extractable text.`),
      extractor,
      mimeType,
      byteLength: fetched.byteLength,
    };
  }

  const effectiveMaxChars = typeof maxChars === 'number' ? maxChars : normalizedText.length;
  if (normalizedText.length > effectiveMaxChars) {
    const truncatedText = truncateText(
      normalizedText,
      effectiveMaxChars,
      opts.truncateStrategy ?? 'head_tail',
      opts.headChars,
      opts.tailChars,
    );
    return {
      kind: 'truncated',
      text: truncatedText,
      message: buildSystemMessage(
        `File '${filename}' truncated to ${effectiveMaxChars.toLocaleString()} characters to fit size limits (${formatLimitNotice(
          maxBytes,
          maxChars,
        )}).`,
      ),
      extractor,
      mimeType,
      byteLength: fetched.byteLength,
    };
  }

  return {
    kind: 'ok',
    text: normalizedText,
    extractor,
    mimeType,
    byteLength: fetched.byteLength,
  };
}
