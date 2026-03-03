import {
  discordRestRequest,
  type DiscordRestFileInput,
  type DiscordRestMethod,
  type DiscordRestMultipartBodyMode,
} from './discordRest';

type ChannelGuildCacheEntry = {
  guildId: string | null;
  expiresAtMs: number;
};

const CHANNEL_GUILD_CACHE_TTL_MS = 5 * 60 * 1000;
const CHANNEL_GUILD_CACHE_MAX_ENTRIES = 512;
const channelGuildCache = new Map<string, ChannelGuildCacheEntry>();
const SENSITIVE_KEY_PATTERN = /(?:authorization|api[_-]?key|token|secret|password|cookie|session)/i;

function sanitizeDiscordRestString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi, 'Bearer [REDACTED]')
    .replace(/\bBot\s+[A-Za-z0-9._~+/=-]{20,}\b/gi, 'Bot [REDACTED]')
    .replace(/(\/webhooks\/\d+\/)[A-Za-z0-9._-]{20,}/gi, '$1[REDACTED]');
}

function sanitizeDiscordRestValue(value: unknown, depth = 0): unknown {
  if (depth >= 8) return '[…]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeDiscordRestString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiscordRestValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = sanitizeDiscordRestValue(record[key], depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

function sanitizeDiscordRestResultForTool(result: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...result };
  const isJson = out.isJson === true;

  if (typeof out.data !== 'undefined') {
    out.data = sanitizeDiscordRestValue(out.data);
  }
  if (typeof out.error === 'string') {
    out.error = sanitizeDiscordRestString(out.error);
  }
  if (typeof out.rawText === 'string') {
    out.rawText = isJson ? '[omitted]' : sanitizeDiscordRestString(out.rawText);
  }

  return out;
}

function pruneChannelGuildCache(nowMs: number): void {
  if (channelGuildCache.size === 0) return;

  for (const [channelId, entry] of channelGuildCache.entries()) {
    if (entry.expiresAtMs <= nowMs) {
      channelGuildCache.delete(channelId);
    }
  }

  if (channelGuildCache.size <= CHANNEL_GUILD_CACHE_MAX_ENTRIES) return;

  const overflow = channelGuildCache.size - CHANNEL_GUILD_CACHE_MAX_ENTRIES;
  let removed = 0;
  for (const channelId of channelGuildCache.keys()) {
    channelGuildCache.delete(channelId);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function normalizePathForParsing(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error('Discord REST path must not be empty.');
  }
  if (/^https?:\/\//i.test(trimmed)) {
    throw new Error('Discord REST path must be a relative API path (starting with "/"), not a full URL.');
  }
  if (!trimmed.startsWith('/')) {
    throw new Error('Discord REST path must start with "/".');
  }
  if (trimmed.includes('\0')) {
    throw new Error('Discord REST path must not include null bytes.');
  }
  if (trimmed.includes('\\')) {
    throw new Error('Discord REST path must not include backslashes.');
  }
  const withoutQuery = trimmed.split('?')[0] ?? trimmed;
  const withoutHash = (withoutQuery.split('#')[0] ?? withoutQuery).trim();
  return withoutHash;
}

function splitPathSegments(rawPath: string): string[] {
  const normalized = normalizePathForParsing(rawPath);
  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const decoded: string[] = [];
  for (const segment of segments) {
    const lowered = segment.toLowerCase();
    if (lowered.includes('%2f') || lowered.includes('%5c') || lowered.includes('%00')) {
      throw new Error('Discord REST path contains disallowed percent-encoded characters.');
    }

    let value = segment;
    if (segment.includes('%')) {
      try {
        value = decodeURIComponent(segment);
      } catch {
        throw new Error('Discord REST path contains invalid percent-encoding.');
      }
    }

    if (value === '.' || value === '..') {
      throw new Error('Discord REST path must not contain dot-segments (./ or ../).');
    }
    if (value.includes('\0') || value.includes('\\')) {
      throw new Error('Discord REST path must not include null bytes or backslashes.');
    }

    decoded.push(value);
  }

  return decoded;
}

function parseGuildIdFromDiscordChannelResponse(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const guildId = (data as Record<string, unknown>).guild_id;
  return typeof guildId === 'string' && guildId.trim().length > 0 ? guildId.trim() : null;
}

function assertSafeIdSegment(value: string, label: string): void {
  if (!value) {
    throw new Error(`Discord REST ${label} must not be empty.`);
  }
  if (value.includes('%')) {
    throw new Error(`Discord REST ${label} must not include percent-encoding.`);
  }
  if (value.includes('?') || value.includes('#') || value.includes('/')) {
    throw new Error(`Discord REST ${label} is invalid.`);
  }
}

async function resolveChannelGuildId(params: {
  channelId: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const channelId = params.channelId.trim();
  if (!channelId) {
    throw new Error('Discord REST channelId must not be empty.');
  }

  const nowMs = Date.now();
  pruneChannelGuildCache(nowMs);
  const cached = channelGuildCache.get(channelId);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.guildId;
  }

  const result = await discordRestRequest({
    method: 'GET',
    path: `/channels/${channelId}`,
    maxResponseChars: 2_000,
    signal: params.signal,
  });

  if (!result.ok) {
    const status = String(result.status ?? 'unknown');
    const statusText = String(result.statusText ?? '').trim();
    throw new Error(`Failed to validate channel scope (GET /channels/${channelId} → ${status} ${statusText}).`);
  }

  const guildId = parseGuildIdFromDiscordChannelResponse(result.data);
  channelGuildCache.set(channelId, { guildId, expiresAtMs: nowMs + CHANNEL_GUILD_CACHE_TTL_MS });
  pruneChannelGuildCache(nowMs);
  return guildId;
}

export async function assertDiscordRestRequestGuildScoped(params: {
  guildId: string;
  method: DiscordRestMethod | string;
  path: string;
  signal?: AbortSignal;
}): Promise<void> {
  const guildId = params.guildId.trim();
  if (!guildId) {
    throw new Error('Discord REST passthrough is restricted to guild-scoped requests.');
  }
  void params.method;

  const segments = splitPathSegments(params.path);
  const root = segments[0]?.toLowerCase();
  if (!root) {
    throw new Error('Discord REST path must not be empty.');
  }

  if (root === 'webhooks') {
    throw new Error('Direct /webhooks/* REST paths are blocked. Use /channels/{channelId}/webhooks instead.');
  }

  if (root === 'guilds') {
    const targetGuildId = segments[1]?.trim();
    if (!targetGuildId) {
      throw new Error('Discord REST guild routes must include a guild id.');
    }
    assertSafeIdSegment(targetGuildId, 'guild id');
    if (targetGuildId !== guildId) {
      throw new Error('Discord REST passthrough is restricted to the active guild (cross-guild /guilds/* is blocked).');
    }
    return;
  }

  const ensureChannelInGuild = async (channelId: string): Promise<void> => {
    const resolvedGuildId = await resolveChannelGuildId({ channelId, signal: params.signal });
    if (!resolvedGuildId) {
      throw new Error('Discord REST passthrough is restricted to guild channels (DM channels are blocked).');
    }
    if (resolvedGuildId !== guildId) {
      throw new Error('Discord REST passthrough is restricted to the active guild (cross-guild /channels/* is blocked).');
    }
  };

  if (root === 'channels') {
    const channelId = segments[1]?.trim();
    if (!channelId) {
      throw new Error('Discord REST channel routes must include a channel id.');
    }
    assertSafeIdSegment(channelId, 'channel id');
    await ensureChannelInGuild(channelId);
    return;
  }

  if (root === 'stage-instances') {
    const channelId = segments[1]?.trim();
    if (!channelId) {
      throw new Error('Discord REST stage-instances routes must include a channel id.');
    }
    assertSafeIdSegment(channelId, 'channel id');
    await ensureChannelInGuild(channelId);
    return;
  }

  throw new Error(
    'Discord REST passthrough is restricted to guild-scoped routes. Allowed: /guilds/{guildId}/*, /channels/{channelId}/*, /stage-instances/{channelId}/*.',
  );
}

export async function discordRestRequestGuildScoped(params: {
  guildId: string;
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
  await assertDiscordRestRequestGuildScoped({
    guildId: params.guildId,
    method: params.method,
    path: params.path,
    signal: params.signal,
  });

  const result = await discordRestRequest({
    method: params.method,
    path: params.path,
    query: params.query,
    body: params.body,
    files: params.files,
    multipartBodyMode: params.multipartBodyMode,
    reason: params.reason,
    maxResponseChars: params.maxResponseChars,
    signal: params.signal,
  });

  return sanitizeDiscordRestResultForTool(result);
}
