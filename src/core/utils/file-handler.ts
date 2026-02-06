export type FetchAttachmentTextOptions = {
  timeoutMs: number;
  maxBytes: number;
  maxChars?: number;
  truncateStrategy?: 'head' | 'head_tail';
  headChars?: number;
  tailChars?: number;
};

export type FetchAttachmentResult =
  | { kind: 'skip'; reason: string }
  | { kind: 'too_large'; message: string }
  | { kind: 'truncated'; text: string; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; text: string };

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_FILENAME_LENGTH = 200;
const ALLOWED_EXTENSIONS = new Set([
  'txt',
  'md',
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'json',
  'html',
  'css',
  'log',
  'env',
  'yml',
  'yaml',
  'sh',
  'sql',
  'toml',
  'ini',
  'graphql',
  'prisma',
]);

function buildSystemMessage(message: string): string {
  return `[System: ${message}]`;
}

function normalizeFilename(filename: string): string {
  return filename.split('?')[0]?.split('#')[0] ?? filename;
}

function getExtension(filename: string): string | null {
  const sanitized = normalizeFilename(filename);
  const lastSegment = sanitized.split('/').pop() ?? sanitized;
  const parts = lastSegment.split('.');
  if (parts.length < 2) {
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

export async function fetchAttachmentText(
  url: string,
  filename: string,
  opts: Partial<FetchAttachmentTextOptions> = {},
): Promise<FetchAttachmentResult> {
  if (!url) {
    return { kind: 'skip', reason: buildSystemMessage('Attachment URL missing; skipped.') };
  }

  if (isFilenameSuspicious(filename)) {
    return {
      kind: 'skip',
      reason: buildSystemMessage('Attachment filename missing or suspicious; skipped.'),
    };
  }

  const extension = getExtension(filename);
  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
    return {
      kind: 'skip',
      reason: buildSystemMessage(`Attachment '${filename}' is not a supported text/code file.`),
    };
  }

  const maxBytes = resolveMaxBytes(opts);
  const maxChars = resolveMaxChars(opts, Math.floor(maxBytes / 2));
  if (maxBytes <= 0 || (typeof maxChars === 'number' && maxChars <= 0)) {
    return {
      kind: 'too_large',
      message: buildSystemMessage(`File '${filename}' omitted due to context limits.`),
    };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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

    const contentType = response.headers.get('content-type')?.toLowerCase();
    if (contentType?.startsWith('image/')) {
      return {
        kind: 'skip',
        reason: buildSystemMessage(`Attachment '${filename}' is an image; skipped.`),
      };
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const length = Number(contentLength);
      if (Number.isFinite(length) && length > maxBytes) {
        return {
          kind: 'too_large',
          message: buildSystemMessage(
            `File '${filename}' is too large to read (Limit: ${formatLimitNotice(
              maxBytes,
              maxChars,
            )}).`,
          ),
        };
      }
    }

    const text = await response.text();
    const byteLength = new TextEncoder().encode(text).byteLength;
    const effectiveMaxChars = typeof maxChars === 'number' ? maxChars : text.length;

    if (byteLength > maxBytes || text.length > effectiveMaxChars) {
      const truncatedText = truncateText(
        text,
        effectiveMaxChars,
        opts.truncateStrategy ?? 'head_tail',
        opts.headChars,
        opts.tailChars,
      );
      return {
        kind: 'truncated',
        text: truncatedText,
        message: buildSystemMessage(
          `File '${filename}' truncated to ${effectiveMaxChars.toLocaleString()} characters to fit size limits.`,
        ),
      };
    }

    return { kind: 'ok', text };
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
