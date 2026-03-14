import { logger } from '../../platform/logging/logger';
import { normalizeTimeoutMs } from '../../shared/utils/timeout';
import { getGuildApiKey, upsertGuildApiKey } from './guildSettingsRepo';

interface PollinationsProfileSummary {
  id?: string;
  username?: string;
  credits?: number;
}

export type ProfileVerificationFailureReason =
  | 'unauthorized'
  | 'timeout'
  | 'upstream'
  | 'invalid_response'
  | 'network';

export type ProfileVerificationResult =
  | { ok: true; profile: PollinationsProfileSummary }
  | { ok: false; reason: ProfileVerificationFailureReason };

export const GUILD_API_KEY_MAX_LENGTH = 256;
export const DEFAULT_PROFILE_TIMEOUT_MS = 30_000;
const MIN_PROFILE_TIMEOUT_MS = 1_000;
const MAX_PROFILE_TIMEOUT_MS = 120_000;
const POLLINATIONS_PROFILE_URL = 'https://gen.pollinations.ai/account/profile';
export const POLLINATIONS_AUTHORIZE_URL =
  'https://enter.pollinations.ai/authorize?redirect_url=https://pollinations.ai/&permissions=profile,balance,usage';

function normalizeApiKey(rawApiKey: string): string {
  return rawApiKey.trim();
}

function maskApiKey(apiKey: string): string {
  const normalized = normalizeApiKey(apiKey);
  return normalized.length > 8 ? `${normalized.slice(0, 4)}...${normalized.slice(-4)}` : 'sk_...';
}

function asRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  return payload as Record<string, unknown>;
}

function readTrimmedString(record: Record<string, unknown> | null, key: string): string | undefined {
  if (!record) return undefined;
  const value = record[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readFiniteNumber(record: Record<string, unknown> | null, key: string): number | undefined {
  if (!record) return undefined;
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parsePollinationsProfileSummary(payload: unknown): PollinationsProfileSummary | null {
  const root = asRecord(payload);
  if (!root) return null;

  const data = asRecord(root.data);
  const user = asRecord(root.user);
  const records = [root, data, user];

  let id: string | undefined;
  let username: string | undefined;
  let credits: number | undefined;
  for (const record of records) {
    id ??= readTrimmedString(record, 'id');
    username ??= readTrimmedString(record, 'username');
    credits ??= readFiniteNumber(record, 'credits');
    credits ??= readFiniteNumber(record, 'balance');
  }

  return { id, username, credits };
}

export function resolveProfileTimeoutMs(timeoutMs: number | undefined): number {
  return normalizeTimeoutMs(timeoutMs, {
    fallbackMs: DEFAULT_PROFILE_TIMEOUT_MS,
    minMs: MIN_PROFILE_TIMEOUT_MS,
    maxMs: MAX_PROFILE_TIMEOUT_MS,
  });
}

export function buildGuildApiKeySetupGuidance(): string {
  return 'Ask a server admin to use Sage’s setup controls, get a Pollinations key, and submit it through the secure setup modal.';
}

export function buildGuildApiKeyLoginInstructions(): string[] {
  return [
    '**Bring Your Own Pollen (BYOP)**',
    '',
    'To use your own Pollinations credits for this server:',
    '',
    `1. [**Click here to login**](${POLLINATIONS_AUTHORIZE_URL})`,
    '2. After logging in, you will land on the Pollinations homepage.',
    '3. Copy the `sk_...` value from the browser address bar after `#api_key=`.',
    '4. Return to Discord and use Sage’s **Set Server Key** control to paste the key securely.',
  ];
}

export function getKeySetVerificationFailureMessage(reason: ProfileVerificationFailureReason): string {
  switch (reason) {
    case 'unauthorized':
      return 'Pollinations rejected that key. Why: it is invalid or expired. Next: click the login link again, copy a fresh key, and retry.';
    case 'timeout':
      return 'Pollinations timed out while verifying that key. Next: wait a moment and try again.';
    case 'upstream':
      return 'Pollinations returned an error while verifying that key. Next: try again shortly.';
    case 'invalid_response':
      return 'Pollinations returned an unexpected verification response. Next: copy a fresh key and retry.';
    case 'network':
      return 'I could not reach Pollinations to verify that key. Next: check connectivity and try again.';
    default:
      return 'I could not verify that key with Pollinations. Next: try again.';
  }
}

export function getKeyCheckUnverifiedReason(reason: ProfileVerificationFailureReason): string {
  switch (reason) {
    case 'unauthorized':
      return 'Saved key is now rejected by Pollinations (invalid or expired).';
    case 'timeout':
      return 'Pollinations timed out during verification.';
    case 'upstream':
      return 'Pollinations returned an upstream error.';
    case 'invalid_response':
      return 'Pollinations returned an unexpected profile response.';
    case 'network':
      return 'Could not reach Pollinations to verify.';
    default:
      return 'Verification failed for an unknown reason.';
  }
}

export async function fetchPollinationsProfile(
  apiKey: string,
  timeoutMs = DEFAULT_PROFILE_TIMEOUT_MS,
): Promise<ProfileVerificationResult> {
  const boundedTimeoutMs = resolveProfileTimeoutMs(timeoutMs);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), boundedTimeoutMs);
  timeoutId.unref?.();

  try {
    const res = await fetch(POLLINATIONS_PROFILE_URL, {
      headers: { Authorization: `Bearer ${normalizeApiKey(apiKey)}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: 'unauthorized' };
      }
      return { ok: false, reason: 'upstream' };
    }

    const contentType = res.headers?.get?.('content-type')?.toLowerCase() || '';
    if (contentType && !contentType.includes('application/json')) {
      logger.warn({ contentType, timeoutMs: boundedTimeoutMs }, 'Pollinations profile response had non-JSON content type');
      return { ok: false, reason: 'invalid_response' };
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error(String(error));
      logger.warn({ error: parseError.message, timeoutMs: boundedTimeoutMs }, 'Failed to parse Pollinations profile JSON');
      return { ok: false, reason: 'invalid_response' };
    }

    const parsed = parsePollinationsProfileSummary(payload);
    if (!parsed) {
      logger.warn({ timeoutMs: boundedTimeoutMs }, 'Pollinations profile response was not a valid JSON object');
      return { ok: false, reason: 'invalid_response' };
    }

    return { ok: true, profile: parsed };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const reason: ProfileVerificationFailureReason =
      controller.signal.aborted || err.name === 'AbortError' ? 'timeout' : 'network';
    logger.warn(
      { error: err.message, timeoutMs: boundedTimeoutMs, aborted: controller.signal.aborted, reason },
      'Failed to fetch Pollinations profile',
    );
    return { ok: false, reason };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function saveVerifiedGuildApiKey(params: {
  guildId: string;
  rawApiKey: string;
  timeoutMs?: number;
}): Promise<
  | { ok: true; accountLabel: string; balanceText: string | null; normalizedApiKey: string }
  | { ok: false; reason: 'invalid_format' | ProfileVerificationFailureReason }
> {
  const normalizedApiKey = normalizeApiKey(params.rawApiKey);
  if (!normalizedApiKey.startsWith('sk_') || normalizedApiKey.length > GUILD_API_KEY_MAX_LENGTH) {
    return { ok: false, reason: 'invalid_format' };
  }

  const verification = await fetchPollinationsProfile(normalizedApiKey, params.timeoutMs);
  if (!verification.ok) {
    return { ok: false, reason: verification.reason };
  }

  await upsertGuildApiKey(params.guildId, normalizedApiKey);
  return {
    ok: true,
    accountLabel: verification.profile.username || verification.profile.id || 'Verified',
    balanceText:
      verification.profile.credits != null ? `${verification.profile.credits} pollen` : null,
    normalizedApiKey,
  };
}

export async function getGuildApiKeyStatus(guildId: string): Promise<
  | { configured: false }
  | {
      configured: true;
      maskedKey: string;
      verification:
        | { ok: true; account: string; balance: string }
        | { ok: false; reason: string };
    }
> {
  const apiKey = (await getGuildApiKey(guildId)) || null;
  if (!apiKey) {
    return { configured: false };
  }

  const normalizedApiKey = normalizeApiKey(apiKey);
  const liveProfile = await fetchPollinationsProfile(normalizedApiKey);
  if (liveProfile.ok) {
    return {
      configured: true,
      maskedKey: maskApiKey(normalizedApiKey),
      verification: {
        ok: true,
        account: liveProfile.profile.username || liveProfile.profile.id || 'Verified',
        balance:
          liveProfile.profile.credits != null ? `${liveProfile.profile.credits} pollen` : 'Unknown',
      },
    };
  }

  return {
    configured: true,
    maskedKey: maskApiKey(normalizedApiKey),
    verification: {
      ok: false,
      reason: getKeyCheckUnverifiedReason(liveProfile.reason),
    },
  };
}

export async function clearGuildApiKey(guildId: string): Promise<void> {
  await upsertGuildApiKey(guildId, null);
}
