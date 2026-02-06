import { config } from '../../config';

/**
 * Manage in-memory overrides for per-guild and per-channel behavior flags.
 *
 * Responsibilities:
 * - Provide logging and proactive overrides with deterministic precedence.
 * - Enforce allowlist/blocklist gates for logging.
 *
 * Non-goals:
 * - Persist overrides to durable storage.
 */
const loggingOverrides = new Map<string, boolean>();
const proactiveOverrides = new Map<string, boolean>();
function makeKey(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

// Cache parsed channel lists at module level to avoid reparsing CSV on every check
let cachedBlocklist: Set<string> | null = null;
let cachedAllowlist: Set<string> | null = null;

function parseChannelList(value: string): Set<string> {
  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

function getBlocklist(): Set<string> {
  if (!cachedBlocklist) {
    cachedBlocklist = parseChannelList(config.INGESTION_BLOCKLIST_CHANNEL_IDS_CSV);
  }
  return cachedBlocklist;
}

function getAllowlist(): Set<string> {
  if (!cachedAllowlist) {
    cachedAllowlist = parseChannelList(config.INGESTION_ALLOWLIST_CHANNEL_IDS_CSV);
  }
  return cachedAllowlist;
}

function isChannelAllowed(channelId: string): boolean {
  const blocklist = getBlocklist();
  if (blocklist.has(channelId)) return false;

  if (config.INGESTION_MODE === 'allowlist') {
    const allowlist = getAllowlist();
    return allowlist.has(channelId);
  }

  return true;
}

/**
 * Determine whether logging is enabled for a specific guild/channel pair.
 *
 * @param guildId - Discord guild ID used to resolve per-guild overrides.
 * @param channelId - Discord channel ID used for allowlist/blocklist checks.
 * @returns True when logging is enabled and the channel is permitted.
 *
 * Side effects:
 * - None.
 *
 * Error behavior:
 * - Does not throw; relies on configuration defaults.
 *
 * Invariants:
 * - Blocklist always overrides allowlist and overrides.
 */
export function isLoggingEnabled(guildId: string, channelId: string): boolean {
  const key = makeKey(guildId, channelId);
  const override = loggingOverrides.get(key);
  if (!config.INGESTION_ENABLED) return false;
  const allowed = isChannelAllowed(channelId);
  if (override !== undefined) return override && allowed;
  return allowed;
}

/**
 * Determine whether proactive posting is enabled for a specific guild/channel pair.
 *
 * @param guildId - Discord guild ID used to resolve per-guild overrides.
 * @param channelId - Discord channel ID used to resolve per-channel overrides.
 * @returns True when proactive posting is enabled for the pair.
 *
 * Side effects:
 * - None.
 *
 * Error behavior:
 * - Does not throw; relies on configuration defaults.
 *
 * Invariants:
 * - Overrides take precedence over environment defaults.
 */
export function isProactiveEnabled(guildId: string, channelId: string): boolean {
  const key = makeKey(guildId, channelId);
  const override = proactiveOverrides.get(key);
  if (override !== undefined) return override;
  return config.PROACTIVE_POSTING_ENABLED;
}

/**
 * Set a logging override for a guild/channel pair.
 *
 * @param guildId - Discord guild ID that scopes the override.
 * @param channelId - Discord channel ID that scopes the override.
 * @param enabled - Override value to apply.
 * @returns Nothing.
 *
 * Side effects:
 * - Mutates in-memory override state.
 *
 * Error behavior:
 * - Does not throw.
 *
 * Invariants:
 * - Overrides are ephemeral and lost on process restart.
 */
export function setLoggingEnabled(guildId: string, channelId: string, enabled: boolean): void {
  const key = makeKey(guildId, channelId);
  loggingOverrides.set(key, enabled);
}

/**
 * Set a proactive posting override for a guild/channel pair.
 *
 * @param guildId - Discord guild ID that scopes the override.
 * @param channelId - Discord channel ID that scopes the override.
 * @param enabled - Override value to apply.
 * @returns Nothing.
 *
 * Side effects:
 * - Mutates in-memory override state.
 *
 * Error behavior:
 * - Does not throw.
 *
 * Invariants:
 * - Overrides are ephemeral and lost on process restart.
 */
export function setProactiveEnabled(guildId: string, channelId: string, enabled: boolean): void {
  const key = makeKey(guildId, channelId);
  proactiveOverrides.set(key, enabled);
}

/**
 * Clear all in-memory overrides.
 *
 * @returns Nothing.
 *
 * Side effects:
 * - Clears logging and proactive override maps.
 *
 * Error behavior:
 * - Does not throw.
 *
 * Invariants:
 * - After execution, no overrides are applied.
 */
export function clearAllOverrides(): void {
  loggingOverrides.clear();
  proactiveOverrides.clear();
}
