import { ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../../core/utils/logger';
import { isAdmin } from '../handlers/sage-command-handlers';
import { getGuildApiKey, upsertGuildApiKey } from '../../core/settings/guildSettingsRepo';
import { normalizeTimeoutMs } from '../../core/utils/timeout';

interface PollinationsProfileSummary {
  id?: string;
  username?: string;
  credits?: number;
}

type ProfileVerificationFailureReason = 'unauthorized' | 'timeout' | 'upstream' | 'invalid_response' | 'network';

type ProfileVerificationResult =
  | { ok: true; profile: PollinationsProfileSummary }
  | { ok: false; reason: ProfileVerificationFailureReason };

const API_KEY_MAX_LENGTH = 256;
const DEFAULT_PROFILE_TIMEOUT_MS = 30_000;
const MIN_PROFILE_TIMEOUT_MS = 1_000;
const MAX_PROFILE_TIMEOUT_MS = 120_000;
const POLLINATIONS_PROFILE_URL = 'https://gen.pollinations.ai/account/profile';

export function resolveProfileTimeoutMs(timeoutMs: number | undefined): number {
  return normalizeTimeoutMs(timeoutMs, {
    fallbackMs: DEFAULT_PROFILE_TIMEOUT_MS,
    minMs: MIN_PROFILE_TIMEOUT_MS,
    maxMs: MAX_PROFILE_TIMEOUT_MS,
  });
}

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
  if (!record) {
    return undefined;
  }

  const value = record[key];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readFiniteNumber(record: Record<string, unknown> | null, key: string): number | undefined {
  if (!record) {
    return undefined;
  }

  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parsePollinationsProfileSummary(payload: unknown): PollinationsProfileSummary | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

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

  return {
    id,
    username,
    credits,
  };
}

function getKeySetVerificationFailureMessage(reason: ProfileVerificationFailureReason): string {
  switch (reason) {
    case 'unauthorized':
      return '❌ **Invalid API Key.** Pollinations rejected this key (invalid or expired). Please run `/sage key login` and try again.';
    case 'timeout':
      return '⚠️ Pollinations timed out while verifying your key. Please try again in a moment.';
    case 'upstream':
      return '⚠️ Pollinations returned an error while verifying your key. Please try again shortly.';
    case 'invalid_response':
      return '⚠️ Pollinations returned an unexpected verification response. Please retry or re-run `/sage key login`.';
    case 'network':
      return '⚠️ Could not reach Pollinations to verify your key. Please check connectivity and try again.';
    default:
      return '⚠️ Failed to verify your key with Pollinations. Please try again.';
  }
}

function getKeyCheckUnverifiedReason(reason: ProfileVerificationFailureReason): string {
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

async function fetchPollinationsProfile(
  apiKey: string,
  timeoutMs = DEFAULT_PROFILE_TIMEOUT_MS,
): Promise<ProfileVerificationResult> {
  const boundedTimeoutMs = resolveProfileTimeoutMs(timeoutMs);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), boundedTimeoutMs);

  try {
    const res = await fetch(POLLINATIONS_PROFILE_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
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
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    const reason: ProfileVerificationFailureReason = controller.signal.aborted || error.name === 'AbortError' ? 'timeout' : 'network';
    logger.warn(
      { error: error.message, timeoutMs: boundedTimeoutMs, aborted: controller.signal.aborted, reason },
      'Failed to fetch Pollinations profile',
    );
    return { ok: false, reason };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function handleKeyLogin(interaction: ChatInputCommandInteraction) {
  const authUrl = `https://enter.pollinations.ai/authorize?redirect_url=https://pollinations.ai/&permissions=profile,balance,usage`;

  const lines = [
    '**Bring Your Own Pollen (BYOP)**',
    '',
    'To use your own credits (unlimited/free usage):',
    '',
    `1. [**Click here to Login**](${authUrl})`,
    '2. After logging in, you will be redirected to the Pollinations homepage.',
    '3. Look at your **browser address bar**. It will look like: "https://pollinations.ai/#api_key=sk_..."',
    '4. Copy the text after "#api_key=" (the part starting with "sk_").',
    '5. Return to Discord and run: `/sage key set <your_key>`',
  ];

  await interaction.reply({
    content: lines.join('\n'),
    ephemeral: true
  });
}

export async function handleKeySet(interaction: ChatInputCommandInteraction) {
  const apiKey = normalizeApiKey(interaction.options.getString('api_key', true));
  const guildId = interaction.guildId;

  if (!apiKey.startsWith('sk_') || apiKey.length > API_KEY_MAX_LENGTH) {
    await interaction.reply({ content: '⚠️ Invalid key format. It should start with `sk_`.', ephemeral: true });
    return;
  }

  if (!guildId) {
    await interaction.reply({ content: '❌ Keys can only be set inside a server.', ephemeral: true });
    return;
  }

  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Only server admins can set the API key.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const verification = await fetchPollinationsProfile(apiKey);
  if (!verification.ok) {
    await interaction.editReply(getKeySetVerificationFailureMessage(verification.reason));
    return;
  }

  try {
    await upsertGuildApiKey(guildId, apiKey);
    const accountLabel = verification.profile.username || verification.profile.id || 'Verified';
    const balanceInfo = verification.profile.credits != null ? ` (Balance: ${verification.profile.credits} pollen)` : '';
    await interaction.editReply(
      `✅ **Server-wide API Key saved!**\n` +
      `Account: ${accountLabel}${balanceInfo}\n` +
      'Sage will now use this key for **all members** in this server.',
    );
  } catch (error) {
    logger.error({ error, guildId }, 'Failed to set API key');
    await interaction.editReply('❌ Failed to save API key (Database error).');
  }
}

export async function handleKeyCheck(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({ content: '❌ Keys can only be checked inside a server.', ephemeral: true });
    return;
  }

  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Only server admins can check the API key.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const apiKey = (await getGuildApiKey(guildId)) || null;

    if (apiKey) {
      const normalizedApiKey = normalizeApiKey(apiKey);
      const masked = maskApiKey(normalizedApiKey);

      const liveProfile = await fetchPollinationsProfile(normalizedApiKey);

      if (liveProfile.ok) {
        const account = liveProfile.profile.username || liveProfile.profile.id || 'Verified';
        const balance = liveProfile.profile.credits != null ? `${liveProfile.profile.credits} pollen` : 'Unknown';
        await interaction.editReply(
          `✅ **Active (Server-wide)**\n` +
          `- **Key**: ${masked}\n` +
          `- **Account**: ${account}\n` +
          `- **Balance**: ${balance}`,
        );
      } else {
        await interaction.editReply(
          `⚠️ **Active (Unverified)**\n` +
          `- **Key**: ${masked}\n` +
          '- **Status**: Key saved, but verification failed.\n' +
          `- **Reason**: ${getKeyCheckUnverifiedReason(liveProfile.reason)}`,
        );
      }
    } else {
      await interaction.editReply(`ℹ️ **No server key set.** Sage is running on the bot's shared quota.`);
    }
  } catch (error) {
    logger.error({ error, guildId }, 'Failed to check API key');
    await interaction.editReply('❌ Failed to check status.');
  }
}

export async function handleKeyClear(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({ content: '❌ Keys can only be cleared inside a server.', ephemeral: true });
    return;
  }

  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Only server admins can clear the API key.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    await upsertGuildApiKey(guildId, null);
    await interaction.editReply('🗑️ **Server-wide API Key removed.** Sage will fall back to the bot\'s shared quota.');
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2025') {
      await interaction.editReply('ℹ️ You didn\'t have a key set.');
    } else {
      logger.error({ error, guildId }, 'Failed to clear API key');
      await interaction.editReply('❌ Failed to clear key.');
    }
  }
}
